import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MetricsModule } from '@app/metrics';
import { SemanticCacheModule } from '@app/semantic-cache';
import { AppConfig } from '@app/shared';

import { RiskScoreService } from './risk-score/risk-score.service';
import { ContentLengthMiddleware } from './stage-1a-content-length/content-length.middleware';
import { RateLimitGuard } from './stage-1b-rate-limit/rate-limit.guard';
import { ExactCacheInterceptor } from './stage-2-exact-cache/exact-cache.interceptor';
import { EntropyInterceptor } from './stage-3-entropy/entropy.interceptor';
import { TokenLimitInterceptor } from './stage-4-token-limit/token-limit.interceptor';
import { MockEmbeddingProvider } from './stage-5-embedding/embedding.mock';
import { OnnxEmbeddingProvider } from './stage-5-embedding/embedding.onnx';
import { EMBEDDING_PROVIDER, EmbeddingService } from './stage-5-embedding/embedding.service';
import { SemanticCacheInterceptor } from './stage-5-embedding/semantic-cache.interceptor';

/**
 * Detection Engine module — registers all 5 cascade stages.
 *
 *  Stage 1a — ContentLengthMiddleware  (NestMiddleware on /v1/chat/*)
 *  Stage 1b — RateLimitGuard           (Guard — independent of body)
 *  Stage 2  — ExactCacheInterceptor    (Interceptor — extracts promptText)
 *  Stage 3  — EntropyInterceptor       (Interceptor — uses promptText)
 *  Stage 4  — TokenLimitInterceptor    (Interceptor — uses promptText)
 *  Stage 5  — SemanticCacheInterceptor (Interceptor — most expensive)
 *
 * Why Stages 3 & 4 are Interceptors, not Guards:
 *   In NestJS the lifecycle is `Guards → Interceptors`. All guards run
 *   before any interceptor. Since Stage 2 (ExactCacheInterceptor) populates
 *   `ctx.promptText` and Stage 3/4 need it, they must also be interceptors
 *   declared AFTER Stage 2 on the controller. Interceptors execute in the
 *   order they appear in @UseInterceptors(...), preserving the cascade.
 */
@Module({
  imports: [SemanticCacheModule, MetricsModule],
  providers: [
    RiskScoreService,
    RateLimitGuard,
    ExactCacheInterceptor,
    EntropyInterceptor,
    TokenLimitInterceptor,
    MockEmbeddingProvider,
    OnnxEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (cfg: ConfigService<AppConfig, true>, mock: MockEmbeddingProvider, onnx: OnnxEmbeddingProvider) => {
        return cfg.get('EMBEDDING_PROVIDER', { infer: true }) === 'onnx' ? onnx : mock;
      },
      inject: [ConfigService, MockEmbeddingProvider, OnnxEmbeddingProvider],
    },
    EmbeddingService,
    SemanticCacheInterceptor,
  ],
  exports: [
    RiskScoreService,
    RateLimitGuard,
    ExactCacheInterceptor,
    EntropyInterceptor,
    TokenLimitInterceptor,
    SemanticCacheInterceptor,
    EmbeddingService,
  ],
})
export class DetectionEngineModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ContentLengthMiddleware)
      .forRoutes({ path: 'v1/chat/(.*)', method: RequestMethod.POST });
  }
}
