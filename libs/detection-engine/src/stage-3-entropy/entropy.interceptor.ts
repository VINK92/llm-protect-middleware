import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

import { CascadeMetricsService } from '@app/metrics';
import {
  AppConfig,
  DetectionStage,
  ERROR_CODES,
  RequestContext,
  getRequestContext,
  shannonEntropy,
} from '@app/shared';

/**
 * Stage 3 — Shannon entropy analysis. Implemented as an Interceptor (not Guard)
 * because NestJS runs ALL guards before ANY interceptor — but our cascade
 * order requires Stage 3 to execute AFTER Stage 2 (ExactCacheInterceptor)
 * which extracts `ctx.promptText`.
 *
 * Interceptors run in the order declared on @UseInterceptors(...), so the
 * cascade ordering 2 → 3 → 4 → 5 is preserved.
 */
@Injectable()
export class EntropyInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  private readonly min: number;
  private readonly max: number;
  private readonly minLength: number;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_ENTROPY_ENABLED', { infer: true });
    this.min = Number(cfg.get('STAGE_ENTROPY_MIN'));
    this.max = Number(cfg.get('STAGE_ENTROPY_MAX'));
    this.minLength = Number(cfg.get('STAGE_ENTROPY_MIN_LENGTH'));
  }

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const req = execCtx.switchToHttp().getRequest();
    const ctx = getRequestContext(req) as RequestContext | undefined;
    if (!ctx?.promptText) return next.handle();
    if (ctx.promptText.length < this.minLength) return next.handle();

    const start = process.hrtime.bigint();
    const entropy = shannonEntropy(ctx.promptText);
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.metrics.observeStage(DetectionStage.ENTROPY, elapsed);

    const tooRandom = entropy > this.max;
    const tooRepetitive = entropy < this.min;
    const riskScore = Math.round(
      tooRandom
        ? Math.min(100, ((entropy - this.max) / (8 - this.max)) * 100)
        : tooRepetitive
          ? Math.min(100, ((this.min - entropy) / this.min) * 100)
          : 0,
    );

    if (tooRandom || tooRepetitive) {
      this.metrics.incBlocked(DetectionStage.ENTROPY);
      ctx.stages.push({
        stage: DetectionStage.ENTROPY,
        passed: false,
        risk_score: 100,
        latency_ms: elapsed,
        details: {
          entropy,
          min: this.min,
          max: this.max,
          reason: tooRandom ? 'random' : 'repetitive',
        },
      });
      ctx.finalStage = DetectionStage.ENTROPY;
      throw new HttpException(
        {
          error: {
            code: ERROR_CODES.HIGH_ENTROPY_GARBAGE,
            stage: DetectionStage.ENTROPY,
            message: `Prompt entropy ${entropy.toFixed(
              2,
            )} outside allowed range [${this.min}, ${this.max}]`,
            risk_score: 100,
            request_id: ctx.requestId,
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    ctx.stages.push({
      stage: DetectionStage.ENTROPY,
      passed: true,
      risk_score: riskScore,
      latency_ms: elapsed,
      details: { entropy },
    });
    return next.handle();
  }
}
