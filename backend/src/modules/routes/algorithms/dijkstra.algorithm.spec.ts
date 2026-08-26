import { DijkstraAlgorithm } from './dijkstra.algorithm';
import {
  buildGraph,
  makeCostModel,
  SAMPLE_NETWORK,
} from './__fixtures__/graph.fixture';

describe('DijkstraAlgorithm', () => {
  const dijkstra = new DijkstraAlgorithm();
  const costModel = makeCostModel();

  it('encuentra el camino de coste mínimo', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const path = dijkstra.findPath(graph, 'A', 'F', costModel);

    expect(path).not.toBeNull();
    expect(path?.nodeIds).toEqual(['A', 'B', 'D', 'F']);
    expect(path?.edges.map((edge) => edge.id)).toEqual(['A->B', 'B->D', 'D->F']);
  });

  it('el coste del camino es la suma de los pesos de sus arcos', () => {
    const graph = buildGraph(SAMPLE_NETWORK);
    const path = dijkstra.findPath(graph, 'A', 'F', costModel);

    const expected = (path?.edges ?? []).reduce(
      (sum, edge) => sum + costModel.edgeWeight(edge),
      0,
    );

    expect(path?.weight).toBeCloseTo(expected, 10);
  });

  it('devuelve un camino trivial de coste cero si origen y destino coinciden', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const path = dijkstra.findPath(graph, 'A', 'A', costModel);

    expect(path).toEqual({ nodeIds: ['A'], edges: [], weight: 0 });
  });

  it('devuelve null cuando el destino es inalcanzable', () => {
    // Grafo dirigido sin ningún arco que salga de F hacia atrás, y un nodo aislado.
    const graph = buildGraph([{ from: 'A', to: 'B', distanceKm: 10 }]);
    graph.addNode({ id: 'F', coordinates: { latitude: 2.5, longitude: -75.1 } });

    expect(dijkstra.findPath(graph, 'A', 'F', costModel)).toBeNull();
  });

  it('devuelve null si alguno de los nodos no existe', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    expect(dijkstra.findPath(graph, 'A', 'INEXISTENTE', costModel)).toBeNull();
    expect(dijkstra.findPath(graph, 'INEXISTENTE', 'F', costModel)).toBeNull();
  });

  it('respeta los nodos bloqueados y busca una ruta alternativa', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const path = dijkstra.findPath(graph, 'A', 'F', costModel, {
      blockedNodes: new Set(['D']),
    });

    expect(path?.nodeIds).not.toContain('D');
    expect(path?.nodeIds[path.nodeIds.length - 1]).toBe('F');
  });

  it('respeta los arcos bloqueados', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const path = dijkstra.findPath(graph, 'A', 'F', costModel, {
      blockedEdges: new Set(['D->F']),
    });

    expect(path?.edges.map((edge) => edge.id)).not.toContain('D->F');
  });

  it('penaliza los peajes: con un peaje caro elige el camino más largo', () => {
    const withoutToll = buildGraph(SAMPLE_NETWORK);
    const baseline = dijkstra.findPath(withoutToll, 'A', 'F', costModel);
    expect(baseline?.nodeIds).toEqual(['A', 'B', 'D', 'F']);

    // Mismo grafo, pero el tramo D-F pasa a tener un peaje desproporcionado.
    const withToll = buildGraph(
      SAMPLE_NETWORK.map((spec) =>
        spec.from === 'D' && spec.to === 'F' ? { ...spec, tollCost: 400 } : spec,
      ),
    );

    const rerouted = dijkstra.findPath(withToll, 'A', 'F', costModel);

    expect(rerouted?.edges.map((e) => e.id)).not.toContain('D->F');
  });

  it('desvía la ruta cuando un tramo tiene un incidente crítico', () => {
    const withIncident = buildGraph(
      SAMPLE_NETWORK.map((spec) =>
        spec.from === 'B' && spec.to === 'D'
          ? { ...spec, riskFactor: 1, durationMinutes: 600 }
          : spec,
      ),
    );

    const path = dijkstra.findPath(withIncident, 'A', 'F', costModel);

    expect(path?.edges.map((e) => e.id)).not.toContain('B->D');
  });
});
