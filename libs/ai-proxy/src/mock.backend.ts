import { Injectable } from '@nestjs/common';

import { ChatCompletionDto, ChatCompletionResponseDto, RequestContext } from '@app/shared';

/**
 * Deterministic mock backend — echoes back a synthetic response.
 * Used in CI / tests / demos that don't need a real LLM.
 *
 * Simulates ~150 ms inference latency so cache-hit speedup is visible.
 */
@Injectable()
export class MockBackend {
  async complete(body: ChatCompletionDto, ctx: RequestContext): Promise<ChatCompletionResponseDto> {
    await new Promise((r) => setTimeout(r, 150));

    const userMsg = body.messages.at(-1)?.content ?? '';
    return {
      id: ctx.requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'mock-llm',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `[MOCK] You said: "${userMsg.slice(0, 200)}". This is a synthetic reply produced by the mock backend.`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: ctx.tokenCount ?? 0,
        completion_tokens: 32,
        total_tokens: (ctx.tokenCount ?? 0) + 32,
      },
    };
  }
}
