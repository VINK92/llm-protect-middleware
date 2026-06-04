import { Injectable, Logger } from '@nestjs/common';

import { ChatCompletionResponseDto } from '@app/shared';

import { RedisService } from './redis.service';

/**
 * Stage 2 backing store — flat KV over Redis:
 *   key: exact:<sha256-hex>
 *   val: JSON-serialized ChatCompletionResponseDto
 */
@Injectable()
export class ExactCacheRepository {
  private readonly logger = new Logger(ExactCacheRepository.name);
  private readonly prefix = 'exact:';

  constructor(private readonly redis: RedisService) {}

  async get(hash: string): Promise<ChatCompletionResponseDto | null> {
    try {
      const raw = await this.redis.client.get(this.prefix + hash);
      return raw ? (JSON.parse(raw) as ChatCompletionResponseDto) : null;
    } catch (err) {
      this.logger.warn(`exact cache GET failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set(hash: string, value: ChatCompletionResponseDto, ttlSec: number): Promise<void> {
    try {
      await this.redis.client.setex(this.prefix + hash, ttlSec, JSON.stringify(value));
    } catch (err) {
      this.logger.warn(`exact cache SET failed: ${(err as Error).message}`);
    }
  }
}
