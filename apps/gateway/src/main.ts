import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 5 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter(app.get(Logger)));

  const cfg = app.get(ConfigService);
  const port = Number(cfg.get('PORT') ?? 3000);

  const doc = new DocumentBuilder()
    .setTitle('LLM-Protect Middleware')
    .setDescription(
      'Middleware-система захисту AI API від атак типу Model Denial of Service. ' +
        'Каскадна архітектура: ContentLength → RateLimit → SHA-256 → Entropy → Tokenizer → Embedding.',
    )
    .setVersion('0.1.0')
    .build();
  const swagger = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup('docs', app, swagger);

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🛡  LLM-Protect Middleware listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`📖  OpenAPI docs: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
