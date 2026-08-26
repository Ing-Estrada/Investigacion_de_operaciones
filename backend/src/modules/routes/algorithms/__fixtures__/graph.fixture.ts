import { RoadType } from '@/common/enums';
import { Coordinates } from '@/common/types/geo.types';

import { CostContext, CostModel } from '../cost-model';
import { RoadEdge, RoadGraph } from '../graph.model';

/**
 * Nodos repartidos sobre una retícula real para que la heurística de Haversine tenga
 * distancias con sentido: usar coordenadas (0,0) haría que `h` fuese siempre 0 y A*
 * degeneraría en Dijkstra sin que el test lo detectase.
 */
export const NODE_COORDS: Record<string, Coordinates> = {
  A: { latitude: 2.0, longitude: -76.0 },
  B: { latitude: 2.3, longitude: -75.8 },
  C: { latitude: 2.1, longitude: -75.5 },
  D: { latitude: 2.6, longitude: -75.6 },
  E: { latitude: 2.9, longitude: -75.3 },
  F: { latitude: 2.5, longitude: -75.1 },
};

export interface EdgeSpec {
  from: string;
  to: string;
  distanceKm: number;
  durationMinutes?: number;
  tollCost?: number;
  weatherIntensity?: number;
  riskFactor?: number;
  roadType?: RoadType;
}

export function makeEdge(spec: EdgeSpec): RoadEdge {
  const speedKmh = 80;
  return {
    id: `${spec.from}->${spec.to}`,
    from: spec.from,
    to: spec.to,
    distanceKm: spec.distanceKm,
    baseDurationMinutes: spec.durationMinutes ?? (spec.distanceKm / speedKmh) * 60,
    roadType: spec.roadType ?? RoadType.Principal,
    roadName: `${spec.from}-${spec.to}`,
    tollCost: spec.tollCost ?? 0,
    weatherIntensity: spec.weatherIntensity ?? 0,
    riskFactor: spec.riskFactor ?? 0,
    geometry: [NODE_COORDS[spec.from], NODE_COORDS[spec.to]],
  };
}

/** Construye un grafo dirigido a partir de una lista de arcos. */
export function buildGraph(specs: EdgeSpec[]): RoadGraph {
  const graph = new RoadGraph();

  for (const spec of specs) {
    for (const id of [spec.from, spec.to]) {
      graph.addNode({ id, coordinates: NODE_COORDS[id], name: id });
    }
  }

  for (const spec of specs) {
    graph.addEdge(makeEdge(spec));
  }

  return graph;
}

export const DEFAULT_COST_CONTEXT: CostContext = {
  weights: { distance: 0.4, time: 0.3, cost: 0.2, risk: 0.1 },
  normalization: { distanceKm: 1000, timeMinutes: 1200, costUnits: 500 },
  consumptionLPer100Km: 30,
  fuelPricePerLiter: 1.05,
};

export function makeCostModel(overrides: Partial<CostContext> = {}): CostModel {
  return new CostModel({ ...DEFAULT_COST_CONTEXT, ...overrides });
}

/**
 * Red de prueba con tres caminos distintos de A a F:
 *   A-B-D-F  (más corto en distancia)
 *   A-C-F    (más largo pero directo)
 *   A-B-D-E-F (rodeo)
 */
export const SAMPLE_NETWORK: EdgeSpec[] = [
  { from: 'A', to: 'B', distanceKm: 40 },
  { from: 'B', to: 'D', distanceKm: 35 },
  { from: 'D', to: 'F', distanceKm: 60 },
  { from: 'A', to: 'C', distanceKm: 60 },
  { from: 'C', to: 'F', distanceKm: 90 },
  { from: 'D', to: 'E', distanceKm: 45 },
  { from: 'E', to: 'F', distanceKm: 50 },
  { from: 'B', to: 'C', distanceKm: 40 },
];
