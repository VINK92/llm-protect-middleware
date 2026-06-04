import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CascadeMetricsService } from '@app/metrics';
import { RedisService } from '@app/semantic-cache';
import {
  AppConfig,
  DetectionStage,
  ERROR_CODES,
  RequestContext,
  getRequestContext,
} from '@app/shared';

/**
 * Stage 1b — sliding-window rate limit using Redis INCR + EXPIRE.
 * Cost: ~1 ms per request (single Redis round-trip).
 *
 * Per PRD §FR-5.3, limits apply per-IP / per-API-key.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly windowSec: number;
  private readonly maxReq: number;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly redis: RedisService,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_RATE_LIMIT_ENABLED', { infer: true });
    this.windowSec = Number(cfg.get('STAGE_RATE_LIMIT_WINDOW_SEC'));
    this.maxReq = Number(cfg.get('STAGE_RATE_LIMIT_MAX_REQUESTS'));
  }

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;

    const req = execCtx.switchToHttp().getRequest();
    const ctx = getRequestContext(req) as RequestContext;
    const start = process.hrtime.bigint();

    const key = `rl:${ctx.clientId}:${Math.floor(Date.now() / 1000 / this.windowSec)}`;
    const client = this.redis.client;

    const count = await client.incr(key);
    if (count === 1) await client.expire(key, this.windowSec);

    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.metrics.observeStage(DetectionStage.RATE_LIMIT, elapsed);

    const riskScore = Math.min(100, Math.round((count / this.maxReq) * 100));

    if (count > this.maxReq) {
      this.metrics.incBlocked(DetectionStage.RATE_LIMIT);
      ctx.stages.push({
        stage: DetectionStage.RATE_LIMIT,
        passed: false,
        risk_score: 100,
        latency_ms: elapsed,
        details: { count, max: this.maxReq, windowSec: this.windowSec },
      });
      ctx.finalStage = DetectionStage.RATE_LIMIT;
      throw new HttpException(
        {
          error: {
            code: ERROR_CODES.RATE_LIMITED,
            stage: DetectionStage.RATE_LIMIT,
            message: `Rate limit exceeded: ${count}/${this.maxReq} per ${this.windowSec}s`,
            risk_score: 100,
            request_id: ctx.requestId,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    ctx.stages.push({
      stage: DetectionStage.RATE_LIMIT,
      passed: true,
      risk_score: riskScore,
      latency_ms: elapsed,
      details: { count, max: this.maxReq },
    });
    return true;
  }
}
