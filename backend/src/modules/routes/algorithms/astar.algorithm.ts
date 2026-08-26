import { Injectable } from '@nestjs/common';

import { haversineDistanceKm } from '@/common/types/geo.types';

import { EMPTY_SET, PathfindingAlgorithm, reconstructPath } from './algorithm.interface';
import { CostModel } from './cost-model';
import { Path, RoadEdge, RoadGraph, SearchConstraints } from './graph.model';
import { MinPriorityQueue } from './priority-queue';

/**
 * A* con heurística de Haversine (Hart, Nilsson y Raphael, 1968).
 *
 * Es Dijkstra guiado: en lugar de expandir en todas las direcciones, prioriza los nodos
 * por `f(n) = g(n) + h(n)`, donde `h` estima lo que falta hasta el destino. En una
 * búsqueda punto a punto sobre una red vial esto recorta la exploración drásticamente
 * —Dijkstra abre un disco alrededor del origen, A* una elipse hacia el destino—, aunque
 * la cota superior asintótica siga siendo O(E log V).
 *
 * Optimalidad. `CostModel.heuristic` cumple las dos condiciones necesarias:
 *
 *  - Admisibilidad: nunca sobreestima. Usa distancia en línea recta (siempre ≤ la real
 *    por carretera) y la velocidad máxima del grafo (nadie puede ir más rápido), y
 *    omite los términos de coste y riesgo, cuyo mínimo real es 0.
 *  - Consistencia: para todo arco (n, n'), h(n) ≤ c(n, n') + h(n'). Se deduce de la
 *    desigualdad triangular sobre la distancia del gran círculo. Al ser consistente,
 *    cerrar un nodo definitivamente al extraerlo —el `settled` de abajo— es seguro y no
 *    hace falta reabrir nodos.
 */
@Injectable()
export class AStarAlgorithm implements PathfindingAlgorithm {
  readonly name = 'astar';

  findPath(
    graph: RoadGraph,
    sourceId: string,
    targetId: string,
    costModel: CostModel,
    constraints: SearchConstraints = {},
  ): Path | null {
    const blockedNodes = constraints.blockedNodes ?? EMPTY_SET;
    const blockedEdges = constraints.blockedEdges ?? EMPTY_SET;

    const target = graph.getNode(targetId);
    if (!graph.getNode(sourceId) || !target) return null;
    if (blockedNodes.has(sourceId) || blockedNodes.has(targetId)) return null;

    if (sourceId === targetId) {
      return { nodeIds: [sourceId], edges: [], weight: 0 };
    }

    // Se calcula una sola vez: recorrer todos los arcos por cada evaluación de la
    // heurística convertiría A* en cuadrático.
    const maxSpeedKmh = graph.maxSpeedKmh();

    const estimateToTarget = (nodeId: string): number => {
      const node = graph.getNode(nodeId);
      if (!node) return 0;
      return costModel.heuristic(
        haversineDistanceKm(node.coordinates, target.coordinates),
        maxSpeedKmh,
      );
    };

    /** g(n): coste real acumulado desde el origen. */
    const gScore = new Map<string, number>([[sourceId, 0]]);
    const parentEdges = new Map<string, RoadEdge>();
    const settled = new Set<string>();

    const openSet = new MinPriorityQueue<string>();
    openSet.push(sourceId, estimateToTarget(sourceId));

    while (!openSet.isEmpty) {
      const current = openSet.pop() as string;

      if (settled.has(current)) continue;
      settled.add(current);

      if (current === targetId) {
        return reconstructPath(
          sourceId,
          targetId,
          parentEdges,
          gScore.get(targetId) as number,
          graph.nodeCount,
        );
      }

      const currentG = gScore.get(current) as number;

      for (const edge of graph.neighbors(current)) {
        if (blockedEdges.has(edge.id)) continue;
        if (blockedNodes.has(edge.to) || settled.has(edge.to)) continue;

        const tentativeG = currentG + costModel.edgeWeight(edge);
        const knownG = gScore.get(edge.to) ?? Number.POSITIVE_INFINITY;

        if (tentativeG < knownG) {
          gScore.set(edge.to, tentativeG);
          parentEdges.set(edge.to, edge);
          openSet.push(edge.to, tentativeG + estimateToTarget(edge.to));
        }
      }
    }

    return null;
  }
}
