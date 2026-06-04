import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { AiProxyModule } from '@app/ai-proxy';
import { DetectionEngineModule } from '@app/detection-engine';
import { LoggingModule } from '@app/logging';
import { MetricsModule } from '@app/metrics';
import { SemanticCacheModule } from '@app/semantic-cache';
import { configValidationSchema } from '@app/shared';

import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ChatModule } from './modules/chat/chat.module';
import { HealthController } from './modules/health/health.controller';
import { MetricsController } from './modules/metrics/metrics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: configValidationSchema,
    }),
    LoggingModule,
    MetricsModule,
    SemanticCacheModule,
    AiProxyModule,
    DetectionEngineModule,
    TerminusModule,
    ChatModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
