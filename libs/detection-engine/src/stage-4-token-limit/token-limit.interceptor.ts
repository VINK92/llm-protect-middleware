import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tiktoken, getEncoding } from 'js-tiktoken';
import { Observable } from 'rxjs';

import { CascadeMetricsService } from '@app/metrics';
import {
  AppConfig,
  DetectionStage,
  ERROR_CODES,
  RequestContext,
  getRequestContext,
} from '@app/shared';

/**
 * Stage 4 — local tokenization via tiktoken (BPE). Interceptor (not Guard)
 * for the same reason as Stage 3 — see EntropyInterceptor jsdoc.
 */
@Injectable()
export class TokenLimitInterceptor implements NestInterceptor, OnModuleInit {
  private readonly enabled: boolean;
  private readonly maxTokens: number;
  private encoder!: Tiktoken;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_TOKEN_LIMIT_ENABLED', { infer: true });
    this.maxTokens = Number(cfg.get('STAGE_TOKEN_LIMIT_MAX_TOKENS'));
  }

  onModuleInit(): void {
    this.encoder = getEncoding('cl100k_base');
  }

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const req = execCtx.switchToHttp().getRequest();
    const ctx = getRequestContext(req) as RequestContext | undefined;
    if (!ctx?.promptText) return next.handle();

    const start = process.hrtime.bigint();
    const tokens = this.encoder.encode(ctx.promptText);
    const count = tokens.length;
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.metrics.observeStage(DetectionStage.TOKEN_LIMIT, elapsed);

    ctx.tokenCount = count;

    if (count > this.maxTokens) {
      this.metrics.incBlocked(DetectionStage.TOKEN_LIMIT);
      ctx.stages.push({
        stage: DetectionStage.TOKEN_LIMIT,
        passed: false,
        risk_score: 100,
        latency_ms: elapsed,
        details: { count, max: this.maxTokens },
      });
      ctx.finalStage = DetectionStage.TOKEN_LIMIT;
      throw new HttpException(
        {
          error: {
            code: ERROR_CODES.TOKEN_LIMIT_EXCEEDED,
            stage: DetectionStage.TOKEN_LIMIT,
            message: `Prompt has ${count} tokens, exceeds ${this.maxTokens} limit`,
            risk_score: 100,
            request_id: ctx.requestId,
          },
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    ctx.stages.push({
      stage: DetectionStage.TOKEN_LIMIT,
      passed: true,
      risk_score: Math.round((count / this.maxTokens) * 100),
      latency_ms: elapsed,
      details: { count },
    });
    return next.handle();
  }
}
