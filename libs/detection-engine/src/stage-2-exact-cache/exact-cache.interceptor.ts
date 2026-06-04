import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import { CascadeMetricsService } from '@app/metrics';
import { ExactCacheRepository } from '@app/semantic-cache';
import {
  AppConfig,
  ChatCompletionDto,
  ChatCompletionResponseDto,
  DetectionStage,
  RequestContext,
  canonicalizePrompt,
  getRequestContext,
  sha256Hex,
} from '@app/shared';

/**
 * Stage 2 — SHA-256 exact-match cache.
 * Cost: ~1–2 ms (single Redis GET on a 64-char key).
 *
 * On HIT: short-circuits the cascade entirely — returns cached response
 * WITHOUT computing entropy, tokenization or embedding.
 *
 * On MISS: stores the canonical prompt + hash in ctx for downstream stages
 * AND wraps controller result to populate the cache on success.
 */
@Injectable()
export class ExactCacheInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  private readonly ttlSec: number;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly repo: ExactCacheRepository,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_EXACT_CACHE_ENABLED', { infer: true });
    this.ttlSec = Number(cfg.get('STAGE_EXACT_CACHE_TTL_SEC'));
  }

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const httpCtx = execCtx.switchToHttp();
    const req = httpCtx.getRequest();
    const res = httpCtx.getResponse<FastifyReply>();
    const ctx = getRequestContext(req) as RequestContext;

    const body = req.body as ChatCompletionDto | undefined;
    if (!body?.messages?.length) return next.handle();

    const start = process.hrtime.bigint();
    const canonical = canonicalizePrompt(body.messages);
    const hash = sha256Hex(`${body.model}|${canonical}`);

    ctx.promptText = canonical;
    ctx.promptHash = hash;

    return from(this.repo.get(hash)).pipe(
      switchMap((hit) => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.metrics.observeStage(DetectionStage.EXACT_CACHE, elapsed);

        if (hit) {
          // CACHE HIT — short-circuit (FR-4 / supervisor "fast response").
          this.metrics.incCacheHit('exact');
          ctx.cacheHit = 'exact';
          ctx.finalStage = DetectionStage.EXACT_CACHE;
          ctx.stages.push({
            stage: DetectionStage.EXACT_CACHE,
            passed: true,
            risk_score: 0,
            latency_ms: elapsed,
            details: { hit: true },
          });
          res.header('x-cache', 'HIT');
          res.header('x-cache-type', 'exact');
          return of(hit);
        }

        ctx.cacheHit = false;
        ctx.stages.push({
          stage: DetectionStage.EXACT_CACHE,
          passed: true,
          risk_score: 0,
          latency_ms: elapsed,
          details: { hit: false },
        });
        res.header('x-cache', 'MISS');

        // On AI inference success — write to cache.
        return next.handle().pipe(
          tap((response: ChatCompletionResponseDto) => {
            void this.repo.set(hash, response, this.ttlSec);
          }),
        );
      }),
    );
  }
}
