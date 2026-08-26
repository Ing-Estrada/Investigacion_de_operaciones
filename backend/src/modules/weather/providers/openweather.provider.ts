import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Coordinates } from '@/common/types/geo.types';
import cacheConfig from '@/config/cache.config';
import externalApisConfig from '@/config/external-apis.config';
import { ResilientHttpService } from '@/external-services/resilient-http.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { WeatherData, WeatherProvider } from './weather.provider';

interface OpenWeatherResponse {
  weather?: { description?: string; main?: string }[];
  main?: { temp?: number; humidity?: number };
  wind?: { speed?: number };
  rain?: { '1h'?: number };
  clouds?: { all?: number };
  visibility?: number;
}

const PROVIDER_NAME = 'openweather';

/**
 * Pesos del factor de intensidad. Cada condición aporta su penalización y el total se
 * satura en 1. Los valores salen de la especificación funcional del sistema.
 */
const INTENSITY = {
  rain: 0.3,
  strongWind: 0.2,
  freezing: 0.15,
  heavyClouds: 0.1,
  poorVisibility: 0.25,
} as const;

const STRONG_WIND_KMH = 20;
const POOR_VISIBILITY_METERS = 2000;
const HEAVY_CLOUDS_PERCENT = 80;

@Injectable()
export class OpenWeatherProvider implements WeatherProvider {
  readonly name = PROVIDER_NAME;
  private readonly logger = new Logger(OpenWeatherProvider.name);

  constructor(
    private readonly http: ResilientHttpService,
    private readonly redis: RedisService,
    @Inject(externalApisConfig.KEY)
    private readonly config: ConfigType<typeof externalApisConfig>,
    @Inject(cacheConfig.KEY) private readonly cache: ConfigType<typeof cacheConfig>,
  ) {}

  async getWeather(coordinates: Coordinates): Promise<WeatherData> {
    // Se redondea a 2 decimales (~1,1 km): el parte meteorológico no cambia dentro de
    // esa celda, así que consultar cada vértice de la geometría sería tirar cuota.
    const key = `weather:${coordinates.latitude.toFixed(2)}:${coordinates.longitude.toFixed(2)}`;

    return this.redis.wrap(key, this.cache.ttl.weather, async () => {
      const apiKey = this.config.weather.openWeatherApiKey;
      if (!apiKey) {
        throw new Error('OPENWEATHER_API_KEY no está configurada.');
      }

      const response = await this.http.request<OpenWeatherResponse>(PROVIDER_NAME, {
        method: 'GET',
        url: `${this.config.weather.openWeatherBaseUrl}/weather`,
        params: {
          lat: coordinates.latitude,
          lon: coordinates.longitude,
          appid: apiKey,
          units: 'metric',
          lang: 'es',
        },
      });

      return this.mapResponse(response);
    });
  }

  private mapResponse(response: OpenWeatherResponse): WeatherData {
    // OpenWeather entrega la velocidad del viento en m/s con `units=metric`.
    const windSpeedKmh = (response.wind?.speed ?? 0) * 3.6;
    const rainMmLastHour = response.rain?.['1h'] ?? 0;
    const temperatureCelsius = response.main?.temp ?? 20;
    const cloudsPercent = response.clouds?.all ?? 0;
    const visibilityMeters = response.visibility ?? 10_000;

    const data: WeatherData = {
      temperatureCelsius,
      description: response.weather?.[0]?.description ?? 'sin datos',
      windSpeedKmh,
      humidityPercent: response.main?.humidity ?? 50,
      rainMmLastHour,
      visibilityMeters,
      cloudsPercent,
      intensityFactor: 0,
    };

    data.intensityFactor = this.computeIntensity(data);
    return data;
  }

  /**
   * Traduce las condiciones a un factor 0-1.
   *
   * Se satura en 1 en lugar de dejarlo crecer: el factor multiplica el consumo de
   * combustible (`x (1 + factor)`), y sin tope una tormenta con viento, hielo y
   * visibilidad nula produciría un consumo dos veces el real.
   */
  private computeIntensity(data: WeatherData): number {
    let intensity = 0;

    if (data.rainMmLastHour > 0) intensity += INTENSITY.rain;
    if (data.windSpeedKmh > STRONG_WIND_KMH) intensity += INTENSITY.strongWind;
    if (data.temperatureCelsius < 0) intensity += INTENSITY.freezing;
    if (data.cloudsPercent > HEAVY_CLOUDS_PERCENT) intensity += INTENSITY.heavyClouds;
    if (data.visibilityMeters < POOR_VISIBILITY_METERS) intensity += INTENSITY.poorVisibility;

    const capped = Math.min(1, intensity);
    if (capped >= 0.6) {
      this.logger.warn(
        `Condiciones adversas (factor ${capped.toFixed(2)}): ${data.description}, ` +
          `viento ${data.windSpeedKmh.toFixed(0)} km/h, lluvia ${data.rainMmLastHour} mm.`,
      );
    }

    return capped;
  }
}
