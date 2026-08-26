import { registerAs } from '@nestjs/config';

import { RoutingProvider, WeatherProvider } from './env.validation';

export interface ExternalApisConfig {
  timeoutMs: number;
  routing: {
    provider: RoutingProvider;
    osrmBaseUrl: string;
    googleApiKey?: string;
  };
  geocoding: {
    nominatimBaseUrl: string;
    userAgent: string;
  };
  weather: {
    provider: WeatherProvider;
    openWeatherBaseUrl: string;
    openWeatherApiKey?: string;
  };
  /** Política de reintentos con backoff exponencial + jitter para todas las llamadas salientes. */
  retry: {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  /** Circuit breaker por proveedor: evita martillar una API caída. */
  circuitBreaker: {
    failureThreshold: number;
    openDurationMs: number;
  };
}

export default registerAs<ExternalApisConfig>('externalApis', () => ({
  timeoutMs: Number(process.env.EXTERNAL_API_TIMEOUT_MS ?? 8000),
  routing: {
    provider: (process.env.ROUTING_PROVIDER ?? RoutingProvider.Osrm) as RoutingProvider,
    osrmBaseUrl: process.env.OSRM_BASE_URL ?? 'http://router.project-osrm.org',
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY || undefined,
  },
  geocoding: {
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
    userAgent: process.env.NOMINATIM_USER_AGENT ?? 'route-optimizer/1.0',
  },
  weather: {
    provider: (process.env.WEATHER_PROVIDER ?? WeatherProvider.OpenWeather) as WeatherProvider,
    openWeatherBaseUrl:
      process.env.OPENWEATHER_BASE_URL ?? 'https://api.openweathermap.org/data/2.5',
    openWeatherApiKey: process.env.OPENWEATHER_API_KEY || undefined,
  },
  retry: {
    attempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 4000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    openDurationMs: 30_000,
  },
}));
