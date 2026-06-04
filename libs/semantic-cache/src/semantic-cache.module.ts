import { Global, Module } from '@nestjs/common';

import { ExactCacheRepository } from './exact-cache.repository';
import { RedisHealthIndicator } from './redis-health.indicator';
import { RedisService } from './redis.service';
import { VectorCacheRepository } from './vector-cache.repository';

@Global()
@Module({
  providers: [RedisService, RedisHealthIndicator, ExactCacheRepository, VectorCacheRepository],
  exports: [RedisService, RedisHealthIndicator, ExactCacheRepository, VectorCacheRepository],
})
export class SemanticCacheModule {}
