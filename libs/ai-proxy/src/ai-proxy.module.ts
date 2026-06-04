import { Module } from '@nestjs/common';

import { AiProxyService } from './ai-proxy.service';
import { MockBackend } from './mock.backend';
import { OllamaClient } from './ollama.client';

@Module({
  providers: [AiProxyService, OllamaClient, MockBackend],
  exports: [AiProxyService],
})
export class AiProxyModule {}
