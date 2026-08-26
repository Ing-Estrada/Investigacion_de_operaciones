import { IncidentSeverity, RoadType } from '@/common/enums';
import { Coordinates } from '@/common/types/geo.types';

/** Nodo de la red vial: normalmente una intersección o un cambio de tipo de vía. */
export interface RoadNode {
  id: string;
  coordinates: Coordinates;
  name?: string;
}

/**
 * Arco dirigido entre dos nodos. Un tramo bidireccional se representa con dos arcos:
 * el coste de ir y de volver no tiene por qué coincidir (pendiente, sentido único,
 * peaje unidireccional, congestión asimétrica).
 */
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  distanceKm: number;
  /** Duración en condiciones normales, sin clima ni incidentes. */
  baseDurationMinutes: number;
  roadType: RoadType;
  roadName?: string;
  /** Peaje del tramo, en la moneda de la configuración. */
  tollCost: number;
  tollStationId?: string | null;
  /** Sobrecoste meteorológico 0-1 (RF-007). */
  weatherIntensity: number;
  weatherCondition?: string | null;
  /** Riesgo agregado 0-1 por incidentes activos en el tramo (RF-008). */
  riskFactor: number;
  incidentSeverity?: IncidentSeverity | null;
  /** Traza del tramo, para dibujarlo y medirlo. */
  geometry: Coordinates[];
  /** Restricciones de acceso que impiden el paso a ciertos vehículos (RF-014). */
  maxHeightMeters?: number | null;
  maxWeightKg?: number | null;
}

export interface Path {
  nodeIds: string[];
  edges: RoadEdge[];
  /** Coste multicriterio acumulado; es lo que minimizan Dijkstra y A*. */
  weight: number;
}

export interface SearchConstraints {
  /** Nodos que la búsqueda no puede visitar (los usa Yen para forzar desvíos). */
  blockedNodes?: ReadonlySet<string>;
  /** Arcos vetados (Yen, o restricciones de vehículo). */
  blockedEdges?: ReadonlySet<string>;
}

/**
 * Grafo dirigido de la red vial, con listas de adyacencia.
 *
 * Se usan listas y no matriz porque una red vial es dispersa: cada intersección conecta
 * con 2-5 vecinos, no con las decenas de miles de nodos del grafo. Una matriz de
 * adyacencia de 50 000 nodos ocuparía 20 GB para almacenar casi solo ceros.
 */
export class RoadGraph {
  private readonly nodes = new Map<string, RoadNode>();
  private readonly adjacency = new Map<string, RoadEdge[]>();
  private readonly edgesById = new Map<string, RoadEdge>();

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edgesById.size;
  }

  addNode(node: RoadNode): RoadNode {
    const existing = this.nodes.get(node.id);
    if (existing) return existing;

    this.nodes.set(node.id, node);
    this.adjacency.set(node.id, []);
    return node;
  }

  addEdge(edge: RoadEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(
        `El arco ${edge.id} referencia un nodo inexistente (${edge.from} -> ${edge.to}).`,
      );
    }

    if (this.edgesById.has(edge.id)) return;

    this.edgesById.set(edge.id, edge);
    (this.adjacency.get(edge.from) as RoadEdge[]).push(edge);
  }

  getNode(id: string): RoadNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: string): RoadEdge | undefined {
    return this.edgesById.get(id);
  }

  /** Arcos salientes de un nodo. Devuelve la lista real, no una copia: no mutarla. */
  neighbors(nodeId: string): readonly RoadEdge[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  allNodes(): IterableIterator<RoadNode> {
    return this.nodes.values();
  }

  allEdges(): IterableIterator<RoadEdge> {
    return this.edgesById.values();
  }

  /**
   * Velocidad máxima observada en el grafo, en km/h. A* la usa como cota para
   * convertir distancia restante en tiempo restante sin dejar de ser admisible:
   * ninguna ruta real puede ir más rápido que el arco más rápido del grafo.
   */
  maxSpeedKmh(): number {
    let max = 1;
    for (const edge of this.edgesById.values()) {
      if (edge.baseDurationMinutes <= 0) continue;
      const speed = edge.distanceKm / (edge.baseDurationMinutes / 60);
      if (Number.isFinite(speed) && speed > max) max = speed;
    }
    return max;
  }

  /** Nodo más cercano a unas coordenadas. Se usa para enganchar origen y destino al grafo. */
  nearestNode(target: Coordinates): RoadNode | undefined {
    let best: RoadNode | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const node of this.nodes.values()) {
      const dLat = node.coordinates.latitude - target.latitude;
      const dLon = node.coordinates.longitude - target.longitude;
      // Distancia euclídea al cuadrado: para comparar cuál está más cerca no hace falta
      // Haversine ni raíz cuadrada, y esto se ejecuta una vez por nodo del grafo.
      const squared = dLat * dLat + dLon * dLon;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = node;
      }
    }

    return best;
  }
}
