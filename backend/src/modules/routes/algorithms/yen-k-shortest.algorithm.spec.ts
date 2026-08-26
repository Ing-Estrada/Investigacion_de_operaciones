import { DijkstraAlgorithm } from './dijkstra.algorithm';
import { pathOverlapRatio, YenKShortestPaths } from './yen-k-shortest.algorithm';
import { buildGraph, makeCostModel, SAMPLE_NETWORK } from './__fixtures__/graph.fixture';

describe('YenKShortestPaths', () => {
  const yen = new YenKShortestPaths();
  const dijkstra = new DijkstraAlgorithm();
  const costModel = makeCostModel();

  it('devuelve K caminos ordenados por coste creciente', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const paths = yen.findKShortest(graph, 'A', 'F', costModel, 3, dijkstra);

    expect(paths.length).toBeGreaterThan(1);
    for (let i = 1; i < paths.length; i += 1) {
      expect(paths[i].weight).toBeGreaterThanOrEqual(paths[i - 1].weight);
    }
  });

  it('el primer camino es exactamente el óptimo de Dijkstra', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const [best] = yen.findKShortest(graph, 'A', 'F', costModel, 3, dijkstra);
    const optimal = dijkstra.findPath(graph, 'A', 'F', costModel);

    expect(best.nodeIds).toEqual(optimal?.nodeIds);
  });

  it('todos los caminos son distintos entre sí', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const paths = yen.findKShortest(graph, 'A', 'F', costModel, 4, dijkstra);
    const signatures = paths.map((path) => path.edges.map((edge) => edge.id).join('>'));

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('ningún camino repite nodos: son loopless por construcción', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const paths = yen.findKShortest(graph, 'A', 'F', costModel, 4, dijkstra);

    for (const path of paths) {
      expect(new Set(path.nodeIds).size).toBe(path.nodeIds.length);
    }
  });

  it('todos los caminos empiezan en el origen y acaban en el destino', () => {
    const graph = buildGraph(SAMPLE_NETWORK);

    const paths = yen.findKShortest(graph, 'A', 'F', costModel, 4, dijkstra);

    for (const path of paths) {
      expect(path.nodeIds[0]).toBe('A');
      expect(path.nodeIds[path.nodeIds.length - 1]).toBe('F');
    }
  });

  it('devuelve menos de K caminos cuando el grafo no tiene más alternativas', () => {
    // Un único camino posible: A -> B -> F.
    const graph = buildGraph([
      { from: 'A', to: 'B', distanceKm: 10 },
      { from: 'B', to: 'F', distanceKm: 10 },
    ]);

    const paths = yen.findKShortest(graph, 'A', 'F', costModel, 5, dijkstra);

    expect(paths).toHaveLength(1);
  });

  it('devuelve una lista vacía si no hay ningún camino', () => {
    const graph = buildGraph([{ from: 'A', to: 'B', distanceKm: 10 }]);
    graph.addNode({ id: 'F', coordinates: { latitude: 2.5, longitude: -75.1 } });

    expect(yen.findKShortest(graph, 'A', 'F', costModel, 3, dijkstra)).toEqual([]);
  });

  it('con K = 1 solo calcula el óptimo', () => {
    const graph = buildGraph(SAMPLE_NETWORK);
    expect(yen.findKShortest(graph, 'A', 'F', costModel, 1, dijkstra)).toHaveLength(1);
  });
});

describe('pathOverlapRatio', () => {
  const graph = buildGraph(SAMPLE_NETWORK);
  const dijkstra = new DijkstraAlgorithm();
  const costModel = makeCostModel();

  it('un camino se solapa consigo mismo al 100%', () => {
    const path = dijkstra.findPath(graph, 'A', 'F', costModel);
    expect(pathOverlapRatio(path!, path!)).toBeCloseTo(1, 10);
  });

  it('dos caminos sin arcos comunes no se solapan', () => {
    const a = { nodeIds: [], edges: [], weight: 0 };
    const withEdges = dijkstra.findPath(graph, 'A', 'F', costModel);

    expect(pathOverlapRatio(a, withEdges!)).toBe(0);
  });

  it('mide la fracción de distancia compartida, no el número de arcos', () => {
    // A-B-D-F es el óptimo. Bloqueando el último tramo y las salidas hacia C, la única
    // alternativa es A-B-D-E-F, que comparte con el óptimo A-B (40 km) y B-D (35 km)
    // de sus 170 km: 75/170 ≈ 0,44.
    const primary = dijkstra.findPath(graph, 'A', 'F', costModel);
    const alternative = dijkstra.findPath(graph, 'A', 'F', costModel, {
      blockedEdges: new Set(['D->F', 'A->C', 'B->C']),
    });

    expect(alternative?.nodeIds).toEqual(['A', 'B', 'D', 'E', 'F']);

    const ratio = pathOverlapRatio(alternative!, primary!);

    expect(ratio).toBeCloseTo(75 / 170, 5);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});
