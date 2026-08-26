import { RoadType } from '@/common/enums';
import { RouteNotFoundException } from '@/common/exceptions/domain.exceptions';
import { Coordinates } from '@/common/types/geo.types';
import { RawRoute, RawRouteSegment } from '@/external-services/routing/routing.provider';

import { GraphBuilderService } from './graph-builder.service';

const P = (latitude: number, longitude: number): Coordinates => ({ latitude, longitude });

function segment(from: Coordinates, to: Coordinates, distanceKm = 10): RawRouteSegment {
  return {
    distanceKm,
    durationMinutes: (distanceKm / 80) * 60,
    geometry: [from, to],
    roadName: 'Vía de prueba',
    roadType: RoadType.Principal,
    tolled: false,
  };
}

function route(segments: RawRouteSegment[]): RawRoute {
  return {
    distanceKm: segments.reduce((sum, s) => sum + s.distanceKm, 0),
    durationMinutes: segments.reduce((sum, s) => sum + s.durationMinutes, 0),
    geometry: segments.flatMap((s) => s.geometry),
    segments,
  };
}

describe('GraphBuilderService', () => {
  const builder = new GraphBuilderService();

  const A = P(2.0, -76.0);
  const B = P(2.2, -75.8);
  const C = P(2.4, -75.6);
  const D = P(2.6, -75.4);

  it('construye nodos y arcos a partir de una traza', () => {
    const result = builder.build([route([segment(A, B), segment(B, C)])]);

    expect(result.graph.nodeCount).toBe(3);
    expect(result.graph.edgeCount).toBe(2);
  });

  it('identifica el origen y el destino', () => {
    const result = builder.build([route([segment(A, B), segment(B, C)])]);

    expect(result.graph.getNode(result.originNodeId)?.coordinates).toEqual(A);
    expect(result.graph.getNode(result.destinationNodeId)?.coordinates).toEqual(C);
  });

  it('fusiona los nodos que comparten varias trazas', () => {
    // Dos rutas que salen de A, se separan y vuelven a juntarse en D. Si los nodos no se
    // fusionaran, la optimización no podría combinar el principio de una con el final
    // de la otra, que es justo lo que aporta construir un grafo en vez de elegir una ruta.
    const primary = route([segment(A, B), segment(B, D)]);
    const alternative = route([segment(A, C), segment(C, D)]);

    const result = builder.build([primary, alternative]);

    expect(result.graph.nodeCount).toBe(4);
    expect(result.graph.edgeCount).toBe(4);
    // Desde A salen dos caminos distintos.
    expect(result.graph.neighbors(result.originNodeId)).toHaveLength(2);
  });

  it('no duplica arcos cuando dos trazas comparten un tramo', () => {
    const first = route([segment(A, B), segment(B, C)]);
    const second = route([segment(A, B), segment(B, D)]);

    const result = builder.build([first, second]);

    // A->B aparece en ambas trazas pero es un único arco.
    expect(result.graph.edgeCount).toBe(3);
  });

  it('omite los tramos cuyos extremos caen en el mismo nodo', () => {
    // OSRM emite pasos de longitud casi nula en las maniobras de salida y llegada.
    const negligible = segment(A, P(2.00001, -76.00001), 0.001);

    const result = builder.build([route([negligible, segment(A, B)])]);

    expect(result.graph.edgeCount).toBe(1);
  });

  it('descarta las geometrías con menos de dos puntos', () => {
    const degenerate: RawRouteSegment = { ...segment(A, B), geometry: [A] };

    const result = builder.build([route([degenerate, segment(A, B)])]);

    expect(result.graph.edgeCount).toBe(1);
  });

  it('acumula la geometría combinada de todas las trazas', () => {
    const result = builder.build([route([segment(A, B)]), route([segment(A, C)])]);

    expect(result.combinedGeometry.length).toBe(4);
  });

  it('lanza RouteNotFoundException si no hay ninguna traza', () => {
    expect(() => builder.build([])).toThrow(RouteNotFoundException);
  });

  it('lanza RouteNotFoundException si la traza no tiene tramos', () => {
    expect(() => builder.build([route([])])).toThrow(RouteNotFoundException);
  });

  it('los arcos conservan distancia, duración y tipo de vía del proveedor', () => {
    const result = builder.build([route([segment(A, B, 42)])]);
    const [edge] = [...result.graph.allEdges()];

    expect(edge.distanceKm).toBe(42);
    expect(edge.baseDurationMinutes).toBeCloseTo((42 / 80) * 60, 5);
    expect(edge.roadType).toBe(RoadType.Principal);
    // El enriquecimiento es un paso posterior: aquí todavía no hay clima ni riesgo.
    expect(edge.weatherIntensity).toBe(0);
    expect(edge.riskFactor).toBe(0);
    expect(edge.tollCost).toBe(0);
  });
});
