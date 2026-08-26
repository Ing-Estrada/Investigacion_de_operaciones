import { Injectable, Logger } from '@nestjs/common';

import { RouteNotFoundException } from '@/common/exceptions/domain.exceptions';
import { Coordinates } from '@/common/types/geo.types';
import { RawRoute } from '@/external-services/routing/routing.provider';
import { RoadEdge, RoadGraph } from '@/modules/routes/algorithms/graph.model';

export interface BuiltGraph {
  graph: RoadGraph;
  originNodeId: string;
  destinationNodeId: string;
  /** Unión de las geometrías de todas las rutas, para las consultas espaciales. */
  combinedGeometry: Coordinates[];
}

/**
 * Precisión con la que se fusionan nodos: 4 decimales de grado son unos 11 metros.
 *
 * Es el parámetro más delicado del constructor. Demasiado fino y dos rutas que pasan
 * por la misma rotonda generan nodos distintos, con lo que el grafo queda desconectado
 * y la optimización no puede combinar tramos de rutas diferentes. Demasiado grueso y se
 * fusionan cruces que en realidad no conectan, inventando atajos inexistentes.
 */
const NODE_PRECISION = 4;

/**
 * Construye el grafo de la red vial a partir de las rutas del proveedor.
 *
 * La idea es que las alternativas del proveedor no son opciones cerradas sino trozos de
 * red: al fusionar sus nodos comunes, la optimización puede componer un camino que use
 * el principio de una alternativa y el final de otra, algo que el proveedor no ofrece.
 */
@Injectable()
export class GraphBuilderService {
  private readonly logger = new Logger(GraphBuilderService.name);

  build(routes: RawRoute[]): BuiltGraph {
    if (routes.length === 0 || routes[0].segments.length === 0) {
      throw new RouteNotFoundException(
        'El proveedor de rutas no devolvió ninguna traza utilizable.',
      );
    }

    const graph = new RoadGraph();
    const combinedGeometry: Coordinates[] = [];

    let originNodeId: string | null = null;
    let destinationNodeId: string | null = null;

    for (const [routeIndex, route] of routes.entries()) {
      combinedGeometry.push(...route.geometry);

      let previousNodeId: string | null = null;

      for (const segment of route.segments) {
        const geometry = segment.geometry;
        if (geometry.length < 2) continue;

        const start = geometry[0];
        const end = geometry[geometry.length - 1];

        const fromId = this.nodeId(start);
        const toId = this.nodeId(end);

        graph.addNode({ id: fromId, coordinates: start });
        graph.addNode({ id: toId, coordinates: end });

        // El origen es el primer nodo utilizable de la primera ruta. Se comprueba contra
        // `null` en lugar de contra el índice 0 porque el proveedor emite tramos de
        // longitud cero en la maniobra de salida: si el primero se descarta, el origen
        // es el siguiente que sí sirve, no "ninguno".
        if (routeIndex === 0 && originNodeId === null) originNodeId = fromId;

        // Un tramo tan corto que sus extremos caen en el mismo nodo no aporta un arco;
        // omitirlo no rompe la conectividad porque el siguiente tramo arranca ahí mismo.
        if (fromId === toId) {
          previousNodeId = toId;
          continue;
        }

        // Si el redondeo separó el final del tramo anterior del inicio de este, se
        // cose la discontinuidad con un arco de coste despreciable. Sin esto, la ruta
        // quedaría partida en dos componentes inconexas.
        if (previousNodeId && previousNodeId !== fromId) {
          this.addEdge(graph, {
            id: this.edgeId(previousNodeId, fromId),
            from: previousNodeId,
            to: fromId,
            distanceKm: 0,
            baseDurationMinutes: 0,
            roadType: segment.roadType,
            roadName: segment.roadName ?? undefined,
            tollCost: 0,
            weatherIntensity: 0,
            riskFactor: 0,
            geometry: [graph.getNode(previousNodeId)?.coordinates ?? start, start],
          });
        }

        this.addEdge(graph, {
          id: this.edgeId(fromId, toId),
          from: fromId,
          to: toId,
          distanceKm: segment.distanceKm,
          baseDurationMinutes: segment.durationMinutes,
          roadType: segment.roadType,
          roadName: segment.roadName ?? undefined,
          // El proveedor marca el tramo como de pago; el importe lo resuelve TollsService
          // contra nuestra tabla de tarifas por categoría.
          tollCost: 0,
          weatherIntensity: 0,
          riskFactor: 0,
          geometry,
        });

        previousNodeId = toId;
        if (routeIndex === 0) destinationNodeId = toId;
      }
    }

    if (!originNodeId || !destinationNodeId) {
      throw new RouteNotFoundException('No se pudieron determinar los nodos de origen y destino.');
    }

    this.logger.debug(
      `Grafo construido: ${graph.nodeCount} nodos, ${graph.edgeCount} arcos ` +
        `a partir de ${routes.length} traza(s).`,
    );

    return { graph, originNodeId, destinationNodeId, combinedGeometry };
  }

  private addEdge(graph: RoadGraph, edge: RoadEdge): void {
    graph.addEdge(edge);
  }

  private nodeId(point: Coordinates): string {
    return `${point.latitude.toFixed(NODE_PRECISION)},${point.longitude.toFixed(NODE_PRECISION)}`;
  }

  private edgeId(fromId: string, toId: string): string {
    return `${fromId}->${toId}`;
  }
}
