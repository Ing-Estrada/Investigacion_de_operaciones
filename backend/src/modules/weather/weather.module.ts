import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { WeatherProvider as ProviderEnum } from '@/config/env.validation';
import cacheConfig from '@/config/cache.config';
import externalApisConfig from '@/config/external-apis.config';
import { ExternalServicesModule } from '@/external-services/external-services.module';
import { ResilientHttpService } from '@/external-services/resilient-http.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { NullWeatherProvider } from './providers/null-weather.provider';
import { OpenWeatherProvider } from './providers/openweather.provider';
import { WEATHER_PROVIDER } from './providers/weather.provider';
import { WeatherService } from './weather.service';

/**
 * El proveedor concreto se elige en el arranque según `WEATHER_PROVIDER`. Sin clave de
 * API se cae al proveedor nulo en lugar de fallar: el sistema debe poder calcular rutas
 * aunque el ajuste meteorológico no esté disponible.
 */
const weatherProvider: Provider = {
  provide: WEATHER_PROVIDER,
  inject: [ConfigService, ResilientHttpService, RedisService, externalApisConfig.KEY, cacheConfig.KEY],
  useFactory: (
    configService: ConfigService,
    http: ResilientHttpService,
    redis: RedisService,
    apis: ReturnType<typeof externalApisConfig>,
    cache: ReturnType<typeof cacheConfig>,
  ) => {
    const selected = configService.get<string>('WEATHER_PROVIDER');
    const hasApiKey = Boolean(apis.weather.openWeatherApiKey);

    if (selected === ProviderEnum.OpenWeather && hasApiKey) {
      return new OpenWeatherProvider(http, redis, apis, cache);
    }

    return new NullWeatherProvider();
  },
};

@Module({
  imports: [
    ConfigModule.forFeature(externalApisConfig),
    ConfigModule.forFeature(cacheConfig),
    ExternalServicesModule,
  ],
  providers: [weatherProvider, WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
