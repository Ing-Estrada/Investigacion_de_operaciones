import { Injectable } from '@nestjs/common';

import { PathfindingAlgorithm, pathSignature } from './algorithm.interface';
import { CostModel } from './cost-model';
import { Path, RoadGraph } from './graph.model';

/**
 * Algoritmo de Yen para los K caminos más cortos sin bucles.
 *
 * Resuelve RF-004 (rutas alternativas). La especificación proponía "excluir el mejor
 * nodo de cada segmento y recalcular"; eso es una aproximación heurística de esta misma
 * idea que no garantiza ni que las rutas obtenidas sean las K mejores ni que estén
 * ordenadas correctamente. Yen sí lo garantiza, y cuesta lo mismo implementarlo bien.
 *
 * Cómo funciona: partiendo del camino óptimo A[0], para cada nodo intermedio (el "nodo
 * de desvío") se prohíbe el arco que el camino anterior tomó desde ahí y se recalcula el
 * tramo restante. Cada candidato es "raíz compartida + desvío nuevo". El mejor candidato
 * pasa a ser A[k] y el proceso se repite.
 *
 * Complejidad: O(K · V · (E log V)) — K iteraciones, hasta V nodos de desvío por
 * iteración, y un Dijkstra por cada uno. Por eso K se mantiene bajo (2-4 alternativas).
 */
@Injectable()
export class YenKShortestPaths {
  /**
   * @param k Número total de caminos deseados, incluido el óptimo.
   */
  findKShortest(
    graph: RoadGraph,
    sourceId: string,
    targetId: string,
    costModel: CostModel,
    k: number,
    baseAlgorithm: PathfindingAlgorithm,
  ): Path[] {
    if (k < 1) return [];

    const shortest = baseAlgorithm.findPath(graph, sourceId, targetId, costModel);
    if (!shortest) return [];

    /** A: caminos ya confirmados, en orden creciente de coste. */
    const confirmed: Path[] = [shortest];
    if (k === 1) return confirmed;

    /** B: candidatos pendientes de confirmar. */
    const candidates: Path[] = [];
    const seenSignatures = new Set<string>([pathSignature(shortest)]);

    for (let iteration = 1; iteration < k; iteration += 1) {
      const previous = confirmed[iteration - 1];

      // Cada nodo del camino anterior, salvo el destino, puede ser nodo de desvío.
      for (let spurIndex = 0; spurIndex < previous.nodeIds.length - 1; spurIndex += 1) {
        const spurNodeId = previous.nodeIds[spurIndex];
        const rootNodeIds = previous.nodeIds.slice(0, spurIndex + 1);
        const rootEdges = previous.edges.slice(0, spurIndex);

        // Se prohíben los arcos ya usados por cualquier camino confirmado que comparta
        // esta misma raíz; de lo contrario se volvería a generar ese mismo camino.
        const blockedEdges = new Set<string>();
        for (const path of confirmed) {
          if (path.edges.length <= spurIndex) continue;
          if (!sharesRoot(path.nodeIds, rootNodeIds)) continue;
          blockedEdges.add(path.edges[spurIndex].id);
        }

        // Se prohíben los nodos de la raíz (menos el de desvío) para que el desvío no
        // vuelva sobre sus pasos: es lo que hace que los caminos sean sin bucles.
        const blockedNodes = new Set(rootNodeIds.slice(0, -1));

        const spurPath = baseAlgorithm.findPath(graph, spurNodeId, targetId, costModel, {
          blockedNodes,
          blockedEdges,
        });

        if (!spurPath) continue;

        const rootWeight = rootEdges.reduce((sum, edge) => sum + costModel.edgeWeight(edge), 0);

        const candidate: Path = {
          // `rootNodeIds` termina en el nodo de desvío y `spurPath.nodeIds` empieza por
          // él: se descarta uno de los dos para no duplicarlo.
          nodeIds: [...rootNodeIds.slice(0, -1), ...spurPath.nodeIds],
          edges: [...rootEdges, ...spurPath.edges],
          weight: rootWeight + spurPath.weight,
        };

        const signature = pathSignature(candidate);
        if (seenSignatures.has(signature)) continue;

        seenSignatures.add(signature);
        candidates.push(candidate);
      }

      if (candidates.length === 0) break;

      candidates.sort((a, b) => a.weight - b.weight);
      confirmed.push(candidates.shift() as Path);
    }

    return confirmed;
  }
}

/** ¿Empieza `nodeIds` exactamente por `rootNodeIds`? */
function sharesRoot(nodeIds: string[], rootNodeIds: string[]): boolean {
  if (nodeIds.length < rootNodeIds.length) return false;
  for (let i = 0; i < rootNodeIds.length; i += 1) {
    if (nodeIds[i] !== rootNodeIds[i]) return false;
  }
  return true;
}

/**
 * Fracción de distancia que dos caminos comparten, 0-1.
 *
 * Yen tiende a devolver variantes casi idénticas al óptimo —cambiar de carril en una
 * rotonda cuenta como camino distinto—. Ofrecerle al usuario tres rutas que solo se
 * diferencian en 300 metros no aporta nada, así que el orquestador descarta las que
 * superan un umbral de solapamiento.
 */
export function pathOverlapRatio(a: Path, b: Path): number {
  if (a.edges.length === 0 || b.edges.length === 0) return 0;

  const edgesOfB = new Set(b.edges.map((edge) => edge.id));

  let shared = 0;
  let total = 0;
  for (const edge of a.edges) {
    total += edge.distanceKm;
    if (edgesOfB.has(edge.id)) shared += edge.distanceKm;
  }

  return total > 0 ? shared / total : 0;
}
