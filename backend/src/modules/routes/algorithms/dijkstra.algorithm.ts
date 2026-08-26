import { Injectable } from '@nestjs/common';

import { EMPTY_SET, PathfindingAlgorithm, reconstructPath } from './algorithm.interface';
import { CostModel } from './cost-model';
import { Path, RoadEdge, RoadGraph, SearchConstraints } from './graph.model';
import { MinPriorityQueue } from './priority-queue';

/**
 * Dijkstra sobre el peso multicriterio (RF-003).
 *
 * Complejidad: O(E log V) en tiempo y O(V + E) en espacio, con heap binario.
 *
 * Requisito de corrección: todos los pesos deben ser no negativos. `CostModel.edgeWeight`
 * lo garantiza por construcción — es una suma de magnitudes no negativas por pesos no
 * negativos. Si alguna vez se añadiera un término negativo (una bonificación, por
 * ejemplo), este algoritmo dejaría de ser válido y habría que sustituirlo por
 * Bellman-Ford.
 */
@Injectable()
export class DijkstraAlgorithm implements PathfindingAlgorithm {
  readonly name = 'dijkstra';

  findPath(
    graph: RoadGraph,
    sourceId: string,
    targetId: string,
    costModel: CostModel,
    constraints: SearchConstraints = {},
  ): Path | null {
    const blockedNodes = constraints.blockedNodes ?? EMPTY_SET;
    const blockedEdges = constraints.blockedEdges ?? EMPTY_SET;

    if (!graph.getNode(sourceId) || !graph.getNode(targetId)) return null;
    if (blockedNodes.has(sourceId) || blockedNodes.has(targetId)) return null;

    if (sourceId === targetId) {
      return { nodeIds: [sourceId], edges: [], weight: 0 };
    }

    /** Mejor coste conocido desde el origen. Ausente = infinito. */
    const distance = new Map<string, number>([[sourceId, 0]]);
    const parentEdges = new Map<string, RoadEdge>();
    /** Nodos con distancia ya definitiva. */
    const settled = new Set<string>();

    const queue = new MinPriorityQueue<string>();
    queue.push(sourceId, 0);

    while (!queue.isEmpty) {
      const current = queue.pop() as string;

      // Entrada obsoleta: el nodo ya se cerró con un coste menor (ver nota en MinPriorityQueue).
      if (settled.has(current)) continue;
      settled.add(current);

      // La primera vez que se extrae el destino, su distancia ya es la óptima:
      // cualquier camino pendiente en la cola cuesta al menos lo mismo.
      if (current === targetId) break;

      const currentDistance = distance.get(current) as number;

      for (const edge of graph.neighbors(current)) {
        if (blockedEdges.has(edge.id)) continue;
        if (blockedNodes.has(edge.to) || settled.has(edge.to)) continue;

        const candidate = currentDistance + costModel.edgeWeight(edge);
        const known = distance.get(edge.to) ?? Number.POSITIVE_INFINITY;

        if (candidate < known) {
          distance.set(edge.to, candidate);
          parentEdges.set(edge.to, edge);
          queue.push(edge.to, candidate);
        }
      }
    }

    if (!settled.has(targetId)) return null;

    return reconstructPath(
      sourceId,
      targetId,
      parentEdges,
      distance.get(targetId) as number,
      graph.nodeCount,
    );
  }
}
