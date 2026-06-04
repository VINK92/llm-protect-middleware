import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import { CascadeMetricsService } from '@app/metrics';
import { VectorCacheRepository } from '@app/semantic-cache';
import {
  AppConfig,
  ChatCompletionResponseDto,
  DetectionStage,
  RequestContext,
  getRequestContext,
} from '@app/shared';

import { EmbeddingService } from './embedding.service';

/**
 * Stage 5 — the MOST EXPENSIVE local step (ONNX embedding ~30–100 ms +
 * vector similarity scan).
 *
 * Per supervisor's plan and PRD §FR-2.2 / §13:
 *   embedding MUST run ONLY when stages 1a–4 have all passed.
 *   This is enforced by the order of @UseGuards / @UseInterceptors in
 *   ChatController — guards (which throw on block) run before this
 *   interceptor's `intercept()` body executes.
 *
 * On semantic hit: short-circuits before AI inference.
 * On miss: lets the controller run, then stores {embedding, response}.
 */
@Injectable()
export class SemanticCacheInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  private readonly threshold: number;
  private readonly ttlSec: number;

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly embeddings: EmbeddingService,
    private readonly vectors: VectorCacheRepository,
    private readonly metrics: CascadeMetricsService,
  ) {
    this.enabled = cfg.get('STAGE_SEMANTIC_CACHE_ENABLED', { infer: true });
    this.threshold = Number(cfg.get('STAGE_SEMANTIC_CACHE_THRESHOLD'));
    this.ttlSec = Number(cfg.get('STAGE_SEMANTIC_CACHE_TTL_SEC'));
  }

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const httpCtx = execCtx.switchToHttp();
    const req = httpCtx.getRequest();
    const res = httpCtx.getResponse<FastifyReply>();
    const ctx = getRequestContext(req) as RequestContext;

    if (!ctx?.promptText) return next.handle();

    const start = process.hrtime.bigint();
    return from(this.embeddings.embed(ctx.promptText)).pipe(
      switchMap((vector) => {
        ctx.embedding = vector;
        this.metrics.incEmbeddingComputed();

        return from(this.vectors.findNearest(vector, this.threshold)).pipe(
          switchMap((nearest) => {
            const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
            this.metrics.observeStage(DetectionStage.SEMANTIC_CACHE, elapsed);

            if (nearest && nearest.similarity >= this.threshold) {
              this.metrics.incCacheHit('semantic');
              ctx.cacheHit = 'semantic';
              ctx.finalStage = DetectionStage.SEMANTIC_CACHE;
              ctx.stages.push({
                stage: DetectionStage.SEMANTIC_CACHE,
                passed: true,
                risk_score: 0,
                latency_ms: elapsed,
                details: { hit: true, similarity: nearest.similarity },
              });
              res.header('x-cache', 'HIT');
              res.header('x-cache-type', 'semantic');
              res.header('x-cache-similarity', nearest.similarity.toFixed(4));
              return of(nearest.response);
            }

            ctx.stages.push({
              stage: DetectionStage.SEMANTIC_CACHE,
              passed: true,
              risk_score: 0,
              latency_ms: elapsed,
              details: { hit: false, bestSimilarity: nearest?.similarity ?? 0 },
            });

            // True miss → call AI, then store {embedding, response}.
            return next.handle().pipe(
              tap((response: ChatCompletionResponseDto) => {
                if (ctx.promptHash) {
                  void this.vectors.store(ctx.promptHash, vector, response, this.ttlSec);
                }
              }),
            );
          }),
        );
      }),
    );
  }
}
