import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import cacheConfig from '@/config/cache.config';

import { RedisService } from './redis.service';

/** Global: caché y rate limiting los usa medio sistema, no tiene sentido reimportarlo. */
@Global()
@Module({
  imports: [ConfigModule.forFeature(cacheConfig)],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
