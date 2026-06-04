import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AppConfig,
  ChatCompletionDto,
  ChatCompletionResponseDto,
  RequestContext,
} from '@app/shared';

import { MockBackend } from './mock.backend';
import { OllamaClient } from './ollama.client';

/**
 * Façade over the AI backend. Selects implementation via AI_BACKEND env-var:
 *   - "ollama" → local Ollama instance
 *   - "mock"   → deterministic stub (CI / tests / Stage-5 hit demos)
 */
@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);
  private readonly backend: 'ollama' | 'mock';

  constructor(
    cfg: ConfigService<AppConfig, true>,
    private readonly ollama: OllamaClient,
    private readonly mock: MockBackend,
  ) {
    this.backend = cfg.get('AI_BACKEND', { infer: true });
    this.logger.log(`AI backend = ${this.backend}`);
  }

  complete(body: ChatCompletionDto, ctx: RequestContext): Promise<ChatCompletionResponseDto> {
    if (this.backend === 'ollama') return this.ollama.complete(body, ctx);
    return this.mock.complete(body, ctx);
  }
}
