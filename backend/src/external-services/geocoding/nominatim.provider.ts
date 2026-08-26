import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Coordinates } from '@/common/types/geo.types';
import cacheConfig from '@/config/cache.config';
import externalApisConfig from '@/config/external-apis.config';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { ResilientHttpService } from '../resilient-http.service';

export interface GeocodingResult {
  displayName: string;
  coordinates: Coordinates;
  /** Tipo OSM del resultado: `city`, `road`, `house`… Útil para ordenar sugerencias. */
  category: string | null;
  importance: number;
}

interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  importance?: number;
}

const PROVIDER_NAME = 'nominatim';

/**
 * Geocodificación directa e inversa con Nominatim (OpenStreetMap).
 *
 * La política de uso de la instancia pública exige un User-Agent identificable y admite
 * como mucho 1 petición por segundo. Se cachea de forma agresiva —24 h— porque una
 * dirección no cambia de coordenadas; en producción con volumen real, lo correcto es
 * levantar una instancia propia de Nominatim.
 */
@Injectable()
export class NominatimGeocodingProvider {
  readonly name = PROVIDER_NAME;

  constructor(
    private readonly http: ResilientHttpService,
    private readonly redis: RedisService,
    @Inject(externalApisConfig.KEY)
    private readonly config: ConfigType<typeof externalApisConfig>,
    @Inject(cacheConfig.KEY) private readonly cache: ConfigType<typeof cacheConfig>,
  ) {}

  /** Dirección o topónimo -> coordenadas. */
  async search(query: string, limit = 5): Promise<GeocodingResult[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 3) return [];

    const cacheKey = `geocode:search:${normalized}:${limit}`;

    return this.redis.wrap(cacheKey, this.cache.ttl.geocoding, async () => {
      const places = await this.http.request<NominatimPlace[]>(PROVIDER_NAME, {
        method: 'GET',
        url: `${this.config.geocoding.nominatimBaseUrl}/search`,
        headers: { 'User-Agent': this.config.geocoding.userAgent },
        params: {
          q: query.trim(),
          format: 'jsonv2',
          limit,
          addressdetails: 0,
        },
      });

      return (places ?? []).map((place) => this.mapPlace(place));
    });
  }

  /** Coordenadas -> dirección legible. */
  async reverse(coordinates: Coordinates): Promise<string | null> {
    const key =
      `geocode:reverse:${coordinates.latitude.toFixed(5)}:${coordinates.longitude.toFixed(5)}`;

    const result = await this.redis.wrap(key, this.cache.ttl.geocoding, async () => {
      const place = await this.http.request<NominatimPlace | { error?: string }>(PROVIDER_NAME, {
        method: 'GET',
        url: `${this.config.geocoding.nominatimBaseUrl}/reverse`,
        headers: { 'User-Agent': this.config.geocoding.userAgent },
        params: {
          lat: coordinates.latitude,
          lon: coordinates.longitude,
          format: 'jsonv2',
        },
      });

      // Nominatim devuelve 200 con `{ error: "Unable to geocode" }` en mitad del océano.
      if (!place || 'error' in place || !('display_name' in place)) {
        return { displayName: null as string | null };
      }

      return { displayName: place.display_name };
    });

    return result.displayName;
  }

  private mapPlace(place: NominatimPlace): GeocodingResult {
    return {
      displayName: place.display_name,
      coordinates: {
        latitude: Number.parseFloat(place.lat),
        longitude: Number.parseFloat(place.lon),
      },
      category: place.category ?? place.type ?? null,
      importance: place.importance ?? 0,
    };
  }
}
