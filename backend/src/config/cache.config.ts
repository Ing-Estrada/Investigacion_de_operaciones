import { registerAs } from '@nestjs/config';

export interface CacheConfig {
  host: string;
  port: number;
  password: string;
  db: number;
  /** TTLs en segundos, por tipo de dato cacheado. */
  ttl: {
    geocoding: number;
    directions: number;
    weather: number;
    tollRates: number;
  };
}

export default registerAs<CacheConfig>('cache', () => ({
  host: process.env.REDIS_HOST as string,
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? '',
  db: Number(process.env.REDIS_DB ?? 0),
  ttl: {
    // Una dirección no cambia de coordenadas: TTL largo.
    geocoding: 86_400,
    // La geometría de la red vial es estable; el tráfico no, pero eso se recalcula aparte.
    directions: 3_600,
    // El clima se refresca cada 30 min en OpenWeather; cachear más no aporta datos nuevos.
    weather: 1_800,
    // Las tarifas de peaje se rigen por fecha de vigencia en BD.
    tollRates: 21_600,
  },
}));
