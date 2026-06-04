import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';

import { AiProxyService } from '@app/ai-proxy';
import {
  EntropyInterceptor,
  ExactCacheInterceptor,
  RateLimitGuard,
  RiskScoreService,
  SemanticCacheInterceptor,
  TokenLimitInterceptor,
} from '@app/detection-engine';
import {
  ChatCompletionDto,
  ChatCompletionResponseDto,
  ErrorResponseDto,
  RequestContext,
  getRequestContext,
} from '@app/shared';

/**
 * The cascade is declared via @UseGuards / @UseInterceptors in exact order
 * specified by PRD §FR-2 and supervisor's plan:
 *
 *   Stage 1a  ContentLengthMiddleware  ── registered as NestJS middleware ──
 *   Stage 1b  RateLimitGuard           ◀── cheap Redis lookup, no body needed
 *   Stage 2   ExactCacheInterceptor    ◀── extracts promptText, SHA-256 O(1)
 *   Stage 3   EntropyInterceptor       ◀── Shannon (needs promptText)
 *   Stage 4   TokenLimitInterceptor    ◀── tiktoken (needs promptText)
 *   Stage 5   SemanticCacheInterceptor ◀── ONNX embedding + vector search
 *
 * Important: NestJS executes ALL guards before ANY interceptor, then runs
 * interceptors in the order declared. That's why Stages 3 & 4 are interceptors
 * (not guards) — they need the promptText set by Stage 2's interceptor.
 */
@ApiTags('chat')
@Controller({ path: 'v1/chat', version: '1' })
@UseGuards(RateLimitGuard)
@UseInterceptors(
  ExactCacheInterceptor,
  EntropyInterceptor,
  TokenLimitInterceptor,
  SemanticCacheInterceptor,
)
export class ChatController {
  constructor(
    private readonly ai: AiProxyService,
    private readonly riskScore: RiskScoreService,
  ) {}

  @Post('completions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chat completions (OpenAI-compatible) protected by the cascade.' })
  @ApiResponse({ status: 200, type: ChatCompletionResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'High-entropy garbage' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'Payload / token limit' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'Rate limit exceeded' })
  async completions(
    @Body() body: ChatCompletionDto,
    @Req() req: FastifyRequest,
  ): Promise<ChatCompletionResponseDto> {
    const ctx = getRequestContext(req) as RequestContext;

    const response = await this.ai.complete(body, ctx);

    ctx.finalStage = 'AI_INFERENCE';
    this.riskScore.finalize(ctx);

    return response;
  }
}
