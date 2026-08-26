import { ConfigType } from '@nestjs/config';

import { RouteNotFoundException } from '@/common/exceptions/domain.exceptions';
import costModelConfig from '@/config/cost-model.config';

import { AStarAlgorithm } from './astar.algorithm';
import { DijkstraAlgorithm } from './dijkstra.algorithm';
import { RouteOptimizerService } from './route-optimizer.service';
import { YenKShortestPaths } from './yen-k-shortest.algorithm';
import { buildGraph, NODE_COORDS, SAMPLE_NETWORK } from './__fixtures__/graph.fixture';

const CONFIG = {
  weights: { distance: 0.4, time: 0.3, cost: 0.2, risk: 0.1 },
  normalization: { distanceKm: 1000, timeMinutes: 1200, costUnits: 500 },
  fuel: { defaultPricePerLiter: 1.05, currency: 'USD' },
  fallbackSpeedKmh: { highway: 90, principal: 70, secondary: 50, tertiary: 35 },
} as unknown as ConfigType<typeof costModelConfig>;

describe('RouteOptimizerService', () => {
  const service = new RouteOptimizerService(
    new DijkstraAlgorithm(),
    new AStarAlgorithm(),
    new YenKShortestPaths(),
    CONFIG,
  );

  const baseRequest = {
    sourceNodeId: 'A',
    targetNodeId: 'F',
    consumptionLPer100Km: 30,
    fuelPricePerLiter: 1.05,
    alternativesWanted: 2,
  };

  it('devuelve la ruta óptima con sus métricas y puntuación', () => {
    const result = service.optimize({ ...baseRequest, graph: buildGraph(SAMPLE_NETWORK) });

    expect(result.best.path.nodeIds).toEqual(['A', 'B', 'D', 'F']);
    expect(result.best.metrics.distanceKm).toBeCloseTo(135, 5);
    // 30 L/100 km sobre 135 km sin penalización climática.
    expect(result.best.metrics.fuelLiters).toBeCloseTo(40.5, 5);
    expect(result.best.score.total).toBeGreaterThan(0);
    expect(result.best.score.total).toBeLessThanOrEqual(100);
  });

  it('usa A* por defecto', () => {
    const result = service.optimize({ ...baseRequest, graph: buildGraph(SAMPLE_NETWORK) });
    expect(result.algorithmUsed).toBe('astar');
  });

  it('permite forzar Dijkstra y obtiene el mismo camino', () => {
    const withAstar = service.optimize({ ...baseRequest, graph: buildGraph(SAMPLE_NETWORK) });
    const withDijkstra = service.optimize({
      ...baseRequest,
      graph: buildGraph(SAMPLE_NETWORK),
      algorithm: 'dijkstra' as const,
    });

    expect(withDijkstra.algorithmUsed).toBe('dijkstra');
    expect(withDijkstra.best.path.nodeIds).toEqual(withAstar.best.path.nodeIds);
  });

  it('devuelve alternativas ordenadas por puntuación descendente', () => {
    const result = service.optimize({
      ...baseRequest,
      graph: buildGraph(SAMPLE_NETWORK),
      alternativesWanted: 3,
    });

    for (let i = 1; i < result.alternatives.length; i += 1) {
      expect(result.alternatives[i].score.total).toBeLessThanOrEqual(
        result.alternatives[i - 1].score.total,
      );
    }
  });

  it('ninguna alternativa coincide con la ruta principal', () => {
    const result = service.optimize({
      ...baseRequest,
      graph: buildGraph(SAMPLE_NETWORK),
      alternativesWanted: 3,
    });

    const bestSignature = result.best.path.edges.map((e) => e.id).join('>');
    for (const alternative of result.alternatives) {
      expect(alternative.path.edges.map((e) => e.id).join('>')).not.toBe(bestSignature);
    }
  });

  it('con alternativesWanted = 0 no devuelve alternativas', () => {
    const result = service.optimize({
      ...baseRequest,
      graph: buildGraph(SAMPLE_NETWORK),
      alternativesWanted: 0,
    });

    expect(result.alternatives).toHaveLength(0);
    expect(result.best).toBeDefined();
  });

  it('evita el peaje cuando se le pide, sin falsear el coste informado', () => {
    // Peaje de 10 unidades en D-F. Es lo bastante barato como para que la ruta óptima
    // lo siga cruzando en condiciones normales (el desvío por A-C-F cuesta más en
    // distancia y tiempo de lo que ahorra), pero multiplicado por la aversión pasa a
    // ser prohibitivo. Un peaje mayor desviaría la ruta ya en el caso neutro y el test
    // no estaría midiendo lo que dice medir.
    const network = SAMPLE_NETWORK.map((spec) =>
      spec.from === 'D' && spec.to === 'F' ? { ...spec, tollCost: 10 } : spec,
    );

    const neutral = service.optimize({ ...baseRequest, graph: buildGraph(network) });
    const avoiding = service.optimize({
      ...baseRequest,
      graph: buildGraph(network),
      avoidTolls: true,
    });

    expect(neutral.best.path.edges.map((e) => e.id)).toContain('D->F');
    expect(avoiding.best.path.edges.map((e) => e.id)).not.toContain('D->F');
    // El coste que se informa sigue siendo el real, no el penalizado.
    expect(avoiding.best.metrics.tollCost).toBe(0);
  });

  it('lanza RouteNotFoundException cuando no hay camino', () => {
    const graph = buildGraph([{ from: 'A', to: 'B', distanceKm: 10 }]);
    graph.addNode({ id: 'F', coordinates: NODE_COORDS.F });

    expect(() => service.optimize({ ...baseRequest, graph, alternativesWanted: 1 })).toThrow(
      RouteNotFoundException,
    );
  });

  it('registra el tiempo de cálculo dentro del objetivo de RNF-008', () => {
    const result = service.optimize({ ...baseRequest, graph: buildGraph(SAMPLE_NETWORK) });

    expect(result.computationTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.computationTimeMs).toBeLessThan(2000);
  });

  it('un vehículo que consume el doble gasta el doble de combustible', () => {
    const normal = service.optimize({ ...baseRequest, graph: buildGraph(SAMPLE_NETWORK) });
    const thirsty = service.optimize({
      ...baseRequest,
      graph: buildGraph(SAMPLE_NETWORK),
      consumptionLPer100Km: 60,
    });

    expect(thirsty.best.metrics.fuelLiters).toBeCloseTo(normal.best.metrics.fuelLiters * 2, 5);
  });
});
