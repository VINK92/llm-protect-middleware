import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import {
  AppConfig,
  ChatCompletionDto,
  ChatCompletionResponseDto,
  ERROR_CODES,
  RequestContext,
} from '@app/shared';

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

@Injectable()
export class OllamaClient {
  private readonly logger = new Logger(OllamaClient.name);
  private readonly http: AxiosInstance;
  private readonly defaultModel: string;

  constructor(cfg: ConfigService<AppConfig, true>) {
    this.http = axios.create({
      baseURL: String(cfg.get('OLLAMA_BASE_URL')),
      timeout: 120_000,
    });
    this.defaultModel = String(cfg.get('OLLAMA_MODEL'));
  }

  async complete(body: ChatCompletionDto, ctx: RequestContext): Promise<ChatCompletionResponseDto> {
    try {
      const { data } = await this.http.post<OllamaChatResponse>('/api/chat', {
        model: body.model || this.defaultModel,
        messages: body.messages,
        stream: false,
        options: body.temperature !== undefined ? { temperature: body.temperature } : undefined,
      });

      return {
        id: ctx.requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: data.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: data.message.content },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: data.prompt_eval_count ?? 0,
          completion_tokens: data.eval_count ?? 0,
          total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      };
    } catch (err) {
      this.logger.error(`Ollama call failed: ${(err as Error).message}`);
      throw new HttpException(
        {
          error: {
            code: ERROR_CODES.UPSTREAM_ERROR,
            message: `Upstream AI backend error: ${(err as Error).message}`,
            request_id: ctx.requestId,
          },
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
