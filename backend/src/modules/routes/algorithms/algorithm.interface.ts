import { CostModel } from './cost-model';
import { Path, RoadEdge, RoadGraph, SearchConstraints } from './graph.model';

/**
 * Contrato común de los algoritmos de camino mínimo. Permite intercambiar Dijkstra por
 * A* —o por cualquier otro— sin tocar el orquestador de rutas, y es lo que hace posible
 * que Yen reutilice cualquiera de los dos como subrutina.
 */
export interface PathfindingAlgorithm {
  readonly name: string;

  /**
   * Camino de coste mínimo entre dos nodos, o `null` si no existe ninguno que respete
   * las restricciones.
   */
  findPath(
    graph: RoadGraph,
    sourceId: string,
    targetId: string,
    costModel: CostModel,
    constraints?: SearchConstraints,
  ): Path | null;
}

export const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Reconstruye el camino siguiendo hacia atrás la cadena de arcos predecesores.
 *
 * El contador de iteraciones no es paranoia gratuita: si un bug introdujera un ciclo en
 * el mapa de predecesores, este bucle colgaría el proceso entero. Cortar por encima del
 * número de nodos convierte ese fallo en una excepción localizable.
 */
export function reconstructPath(
  sourceId: string,
  targetId: string,
  parentEdges: Map<string, RoadEdge>,
  totalWeight: number,
  nodeLimit: number,
): Path {
  const edges: RoadEdge[] = [];
  const nodeIds: string[] = [targetId];

  let current = targetId;
  let iterations = 0;

  while (current !== sourceId) {
    const edge = parentEdges.get(current);
    if (!edge) {
      throw new Error(`Camino incompleto: el nodo ${current} no tiene predecesor.`);
    }

    edges.push(edge);
    current = edge.from;
    nodeIds.push(current);

    iterations += 1;
    if (iterations > nodeLimit) {
      throw new Error('Ciclo detectado al reconstruir el camino.');
    }
  }

  edges.reverse();
  nodeIds.reverse();

  return { nodeIds, edges, weight: totalWeight };
}

/** Identidad de un camino por su secuencia de arcos, para deduplicar candidatos. */
export function pathSignature(path: Path): string {
  return path.edges.map((edge) => edge.id).join('>');
}
