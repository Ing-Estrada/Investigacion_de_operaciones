import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { RoadType } from '@/common/enums';
import { ExternalApiException } from '@/common/exceptions/domain.exceptions';
import { Coordinates } from '@/common/types/geo.types';
import cacheConfig from '@/config/cache.config';
import externalApisConfig from '@/config/external-apis.config';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { ResilientHttpService } from '../resilient-http.service';
import { RawRoute, RawRouteSegment, RoutingProvider, RoutingRequest } from './routing.provider';

// --- Forma de la respuesta de OSRM (subconjunto que usamos) -------------------

interface OsrmGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

interface OsrmIntersection {
  classes?: string[];
}

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  geometry: OsrmGeometry;
  intersections?: OsrmIntersection[];
}

interface OsrmLeg {
  distance: number;
  duration: number;
  steps: OsrmStep[];
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: OsrmGeometry;
  legs: OsrmLeg[];
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

const PROVIDER_NAME = 'osrm';

/**
 * Red vial vía OSRM sobre datos de OpenStreetMap.
 *
 * OSRM devuelve geometría, distancia y duración; el enriquecimiento (clima, incidentes,
 * peajes) y la optimización multicriterio son nuestros. Lo que se usa de aquí es el
 * grafo de calles real, que es exactamente lo que no tiene sentido reimplementar.
 */
@Injectable()
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = PROVIDER_NAME;
  private readonly logger = new Logger(OsrmRoutingProvider.name);

  constructor(
    private readonly http: ResilientHttpService,
    private readonly redis: RedisService,
    @Inject(externalApisConfig.KEY)
    private readonly config: ConfigType<typeof externalApisConfig>,
    @Inject(cacheConfig.KEY) private readonly cache: ConfigType<typeof cacheConfig>,
  ) {}

  async fetchRoutes(request: RoutingRequest): Promise<RawRoute[]> {
    const cacheKey = this.buildCacheKey(request);

    return this.redis.wrap(cacheKey, this.cache.ttl.directions, async () => {
      const coordinates =
        `${format(request.origin.longitude)},${format(request.origin.latitude)};` +
        `${format(request.destination.longitude)},${format(request.destination.latitude)}`;

      const url = `${this.config.routing.osrmBaseUrl}/route/v1/driving/${coordinates}`;

      const response = await this.http.request<OsrmResponse>(PROVIDER_NAME, {
        method: 'GET',
        url,
        params: {
          // `alternatives` acepta un número: es el máximo de rutas extra que OSRM
          // intentará encontrar. No garantiza que las devuelva todas.
          alternatives: Math.max(0, request.alternatives),
          overview: 'full',
          geometries: 'geojson',
          // Necesario para trocear cada ruta en tramos y clasificar el tipo de vía.
          steps: true,
        },
      });

      if (response.code !== 'Ok' || !response.routes?.length) {
        throw new ExternalApiException(
          PROVIDER_NAME,
          `Sin ruta disponible (code=${response.code}${response.message ? `: ${response.message}` : ''})`,
        );
      }

      this.logger.debug(`OSRM devolvió ${response.routes.length} ruta(s).`);
      return response.routes.map((route) => this.mapRoute(route));
    });
  }

  private mapRoute(route: OsrmRoute): RawRoute {
    const segments: RawRouteSegment[] = [];

    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        // OSRM emite pasos de longitud cero en las maniobras de llegada y salida.
        // Convertirlos en arcos crearía nodos duplicados sin aportar nada al grafo.
        if (step.distance <= 0) continue;

        segments.push({
          distanceKm: step.distance / 1000,
          durationMinutes: step.duration / 60,
          geometry: toCoordinates(step.geometry),
          roadName: step.name || step.ref || null,
          roadType: classifyRoad(step),
          tolled: hasClass(step, 'toll'),
        });
      }
    }

    return {
      distanceKm: route.distance / 1000,
      durationMinutes: route.duration / 60,
      geometry: toCoordinates(route.geometry),
      segments,
    };
  }

  private buildCacheKey(request: RoutingRequest): string {
    // Se redondea a 4 decimales (~11 m): pedir la ruta desde dos puntos separados por
    // metros debe reutilizar el mismo resultado en lugar de generar una entrada nueva.
    const o = `${request.origin.latitude.toFixed(4)},${request.origin.longitude.toFixed(4)}`;
    const d = `${request.destination.latitude.toFixed(4)},${request.destination.longitude.toFixed(4)}`;
    return `osrm:route:${o}:${d}:alt${request.alternatives}:toll${request.avoidTolls ? 0 : 1}`;
  }
}

const format = (value: number): string => value.toFixed(6);

const toCoordinates = (geometry: OsrmGeometry): Coordinates[] =>
  (geometry?.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude }));

const hasClass = (step: OsrmStep, className: string): boolean =>
  (step.intersections ?? []).some((intersection) =>
    (intersection.classes ?? []).includes(className),
  );

/**
 * Clasificación de vías (RF-010) a partir de lo que OSRM expone.
 *
 * OSRM no devuelve el tag `highway=*` de OSM directamente, así que se infiere de las
 * clases de la intersección y de si el tramo tiene referencia de carretera. Es una
 * aproximación; si se necesitara la clasificación exacta habría que consultar el
 * `highway` de OSM contra una instancia propia con perfil personalizado.
 */
function classifyRoad(step: OsrmStep): RoadType {
  if (hasClass(step, 'motorway')) return RoadType.Highway;
  if (step.ref) return RoadType.Principal;
  if (step.name) return RoadType.Secondary;
  return RoadType.Tertiary;
}
