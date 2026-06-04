import { Injectable, Logger } from '@nestjs/common';

import { ChatCompletionResponseDto } from '@app/shared';

import { RedisService } from './redis.service';

export interface VectorMatch {
  hash: string;
  similarity: number;
  response: ChatCompletionResponseDto;
}

interface StoredEntry {
  vec: number[];
  response: ChatCompletionResponseDto;
}

/**
 * Stage 5 backing store. MVP implementation: a simple Redis HASH that the
 * service scans + computes cosine similarity in-process.
 *
 * For production scale, swap to Redis Stack's RediSearch with HNSW VECTOR
 * indexing (the docker-compose image is already redis/redis-stack).
 */
@Injectable()
export class VectorCacheRepository {
  private readonly logger = new Logger(VectorCacheRepository.name);
  private readonly hashKey = 'vec:entries';

  constructor(private readonly redis: RedisService) {}

  async store(
    hash: string,
    vector: number[],
    response: ChatCompletionResponseDto,
    ttlSec: number,
  ): Promise<void> {
    try {
      const entry: StoredEntry = { vec: vector, response };
      await this.redis.client.hset(this.hashKey, hash, JSON.stringify(entry));
      // Soft TTL by re-bumping the whole hash; simpler than per-field TTL.
      await this.redis.client.expire(this.hashKey, ttlSec);
    } catch (err) {
      this.logger.warn(`vector cache HSET failed: ${(err as Error).message}`);
    }
  }

  async findNearest(query: number[], threshold: number): Promise<VectorMatch | null> {
    try {
      const all = await this.redis.client.hgetall(this.hashKey);
      let best: VectorMatch | null = null;

      for (const [hash, raw] of Object.entries(all)) {
        const entry = JSON.parse(raw) as StoredEntry;
        if (entry.vec.length !== query.length) continue;

        const sim = cosine(query, entry.vec);
        if (!best || sim > best.similarity) {
          best = { hash, similarity: sim, response: entry.response };
        }
      }

      if (!best) return null;
      return best.similarity >= threshold ? best : best;
    } catch (err) {
      this.logger.warn(`vector cache scan failed: ${(err as Error).message}`);
      return null;
    }
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
