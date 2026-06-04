import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';

import { CascadeMetricsService } from '@app/metrics';
import {
  AppConfig,
  DetectionStage,
  ERROR_CODES,
  RequestContext,
  getRequestContext,
} from '@app/shared';

/**
 * Stage 1a — Content-Length check.
 * The CHEAPEST stage in the cascade: a single integer comparison, no I/O.
 *
 * Per PRD §FR-2, this MUST run first to avoid burning Redis/CPU on
 * obviously oversized payloads.
 */
@Injectable()
export class ContentLengthMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly maxBytes: number;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_CONTENT_LENGTH_ENABLED', { infer: true });
    this.maxBytes = Number(cfg.get('STAGE_CONTENT_LENGTH_MAX_BYTES'));
  }

  use(req: FastifyRequest['raw'], _res: FastifyReply['raw'], next: () => void): void {
    if (!this.enabled) return next();

    const ctx = getRequestContext(req) as RequestContext | undefined;
    const requestId = ctx?.requestId ?? 'req_unknown';
    const start = process.hrtime.bigint();

    const header = req.headers['content-length'];
    const size = typeof header === 'string' ? parseInt(header, 10) : NaN;

    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.metrics.observeStage(DetectionStage.CONTENT_LENGTH, elapsed);

    if (Number.isFinite(size) && size > this.maxBytes) {
      this.metrics.incBlocked(DetectionStage.CONTENT_LENGTH);
      ctx?.stages.push({
        stage: DetectionStage.CONTENT_LENGTH,
        passed: false,
        risk_score: 100,
        latency_ms: elapsed,
        details: { size, max: this.maxBytes },
      });
      if (ctx) ctx.finalStage = DetectionStage.CONTENT_LENGTH;
      throw new HttpException(
        {
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            stage: DetectionStage.CONTENT_LENGTH,
            message: `Request body (${size} B) exceeds ${this.maxBytes} B limit`,
            request_id: requestId,
          },
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    ctx?.stages.push({
      stage: DetectionStage.CONTENT_LENGTH,
      passed: true,
      risk_score: 0,
      latency_ms: elapsed,
    });

    next();
  }
}
