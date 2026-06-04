import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AppConfig, getRequestContext } from '@app/shared';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: String(cfg.get('LOG_LEVEL')),
          transport:
            cfg.get('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
          customProps: (req) => ({
            request_id: getRequestContext(req)?.requestId,
          }),
          autoLogging: { ignore: (req) => req.url === '/v1/health' || req.url === '/v1/metrics' },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
