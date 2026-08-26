import { haversineDistanceKm } from '@/common/types/geo.types';

import { AStarAlgorithm } from './astar.algorithm';
import { DijkstraAlgorithm } from './dijkstra.algorithm';
import {
  buildGraph,
  makeCostModel,
  NODE_COORDS,
  SAMPLE_NETWORK,
} from './__fixtures__/graph.fixture';

describe('AStarAlgorithm', () => {
  const astar = new AStarAlgorithm();
  const dijkstra = new DijkstraAlgorithm();
  const costModel = makeCostModel();

  it('encuentra el mismo óptimo que Dijkstra', () => {
    // Es la propiedad que justifica usar A*: con heurística admisible y consistente no
    // sacrifica optimalidad, solo explora menos. Si esto falla, la heurística sobreestima.
    const graph = buildGraph(SAMPLE_NETWORK);

    const withAstar = astar.findPath(graph, 'A', 'F', costModel);
    const withDijkstra = dijkstra.findPath(graph, 'A', 'F', costModel);

    expect(withAstar?.nodeIds).toEqual(withDijkstra?.nodeIds);
    expect(withAstar?.weight).toBeCloseTo(withDijkstra?.weight ?? -1, 10);
  });

  it('coincide con Dijkstra también sobre grafos generados al azar', () => {
    const nodeIds = Object.keys(NODE_COORDS);

    for (let iteration = 0; iteration < 50; iteration += 1) {
      const specs = [];
      for (const from of nodeIds) {
        for (const to of nodeIds) {
          if (from === to) continue;
          if (Math.random() > 0.45) continue;
          specs.push({
            from,
            to,
            // La distancia declarada nunca es menor que la geodésica: si lo fuera, el
            // grafo describiría un atajo físicamente imposible y la heurística —que se
            // apoya en la línea recta— dejaría legítimamente de ser admisible.
            distanceKm:
              haversineDistanceKm(NODE_COORDS[from], NODE_COORDS[to]) * (1 + Math.random()),
            tollCost: Math.random() < 0.3 ? Math.random() * 20 : 0,
            riskFactor: Math.random() < 0.2 ? Math.random() : 0,
          });
        }
      }

      const graph = buildGraph(specs);
      if (!graph.getNode('A') || !graph.getNode('F')) continue;

      const a = astar.findPath(graph, 'A', 'F', costModel);
      const d = dijkstra.findPath(graph, 'A', 'F', costModel);

      if (d === null) {
        expect(a).toBeNull();
        continue;
      }

      expect(a).not.toBeNull();
      expect(a?.weight).toBeCloseTo(d.weight, 9);
    }
  });

  it('devuelve null cuando no hay camino', () => {
    const graph = buildGraph([{ from: 'A', to: 'B', distanceKm: 10 }]);
    graph.addNode({ id: 'F', coordinates: NODE_COORDS.F });

    expect(astar.findPath(graph, 'A', 'F', costModel)).toBeNull();
  });

  it('respeta las restricciones de nodos y arcos', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const path = astar.findPath(graph, 'A', 'F', costModel, {
      blockedNodes: new Set(['D']),
      blockedEdges: new Set(['C->F']),
    });

    // Bloqueando D y el arco C-F no queda ninguna forma de llegar a F.
    expect(path).toBeNull();
  });
});
