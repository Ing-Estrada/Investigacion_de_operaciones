import { RoadType } from '@/common/enums';
import { Coordinates } from '@/common/types/geo.types';

export interface RoutingRequest {
  origin: Coordinates;
  destination: Coordinates;
  /** Cuántas rutas alternativas pedir al proveedor, además de la principal. */
  alternatives: number;
  avoidTolls?: boolean;
}

/** Tramo homogéneo devuelto por el proveedor: entre dos maniobras consecutivas. */
export interface RawRouteSegment {
  distanceKm: number;
  durationMinutes: number;
  geometry: Coordinates[];
  roadName: string | null;
  roadType: RoadType;
  /** El proveedor marca el tramo como de pago. La tarifa la resuelve nuestro `TollsService`. */
  tolled: boolean;
}

export interface RawRoute {
  distanceKm: number;
  durationMinutes: number;
  geometry: Coordinates[];
  segments: RawRouteSegment[];
}

/**
 * Fuente de la red vial (RF-002).
 *
 * La interfaz existe para que la elección de proveedor sea una decisión de
 * configuración, no de código: OSRM/OpenStreetMap por defecto (sin clave ni coste) y
 * Google Directions donde la cobertura de OSM sea insuficiente. Ambos alimentan el
 * mismo grafo, y la optimización multicriterio es nuestra en los dos casos.
 */
export interface RoutingProvider {
  readonly name: string;
  fetchRoutes(request: RoutingRequest): Promise<RawRoute[]>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
