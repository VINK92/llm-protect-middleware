import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { RedisService } from './redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const reply = await this.redis.client.ping();
      const ok = reply === 'PONG';
      const result = this.getStatus(key, ok, { reply });
      if (!ok) throw new HealthCheckError('Redis unhealthy', result);
      return result;
    } catch (err) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { error: (err as Error).message }),
      );
    }
  }
}
