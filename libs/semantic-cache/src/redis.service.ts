import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

import { AppConfig } from '@app/shared';

/**
 * Single shared ioredis client used by:
 *   - RateLimitGuard       (INCR + EXPIRE)
 *   - ExactCacheRepository (GET / SETEX)
 *   - VectorCacheRepository (HSET + scan)
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client!: Redis;

  constructor(private readonly cfg: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const opts: RedisOptions = {
      host: String(this.cfg.get('REDIS_HOST')),
      port: Number(this.cfg.get('REDIS_PORT')),
      db: Number(this.cfg.get('REDIS_DB')),
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    };
    const password = this.cfg.get('REDIS_PASSWORD');
    if (password) opts.password = String(password);

    this._client = new Redis(opts);
    this._client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this._client.on('ready', () => this.logger.log(`Redis connected (${opts.host}:${opts.port})`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this._client) await this._client.quit();
  }

  get client(): Redis {
    return this._client;
  }
}
