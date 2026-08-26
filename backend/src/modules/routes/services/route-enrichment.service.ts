import { Injectable, Logger } from '@nestjs/common';

import { Coordinates, haversineDistanceKm } from '@/common/types/geo.types';
import { RoadEdge, RoadGraph } from '@/modules/routes/algorithms/graph.model';
import { IncidentHit } from '@/modules/incidents/incidents.service';
import { TollHit } from '@/modules/tolls/tolls.service';
import { RouteWeather, WeatherService } from '@/modules/weather/weather.service';

export interface EnrichmentInput {
  graph: RoadGraph;
  weather: RouteWeather;
  incidents: IncidentHit[];
  tolls: TollHit[];
}

export interface EnrichmentSummary {
  edgesWithIncidents: number;
  edgesWithTolls: number;
  tollsAssigned: number;
  tollsUnassigned: number;
}

/**
 * Distancia máxima entre una estación de peaje y un arco para considerar que el arco
 * pasa por ella. La consulta espacial ya filtró por proximidad a la ruta completa; esto
 * decide a cuál de los arcos concretos se le imputa el importe.
 */
const TOLL_SNAP_RADIUS_KM = 1.0;

/**
 * Vuelca clima, incidentes y peajes sobre los arcos del grafo (RF-007, RF-008, RF-009).
 *
 * Se hace antes de optimizar, no después: si el enriquecimiento fuera posterior, el
 * algoritmo elegiría el camino ignorando la lluvia, los accidentes y los peajes, y esos
 * datos serían decorativos. Al incorporarlos al peso de cada arco, un tramo con un
 * accidente grave o un peaje caro deja de ser atractivo y la optimización desvía la ruta.
 */
@Injectable()
export class RouteEnrichmentService {
  private readonly logger = new Logger(RouteEnrichmentService.name);

  constructor(private readonly weatherService: WeatherService) {}

  enrich(input: EnrichmentInput): EnrichmentSummary {
    const edges = [...input.graph.allEdges()];

    this.applyWeather(edges, input.weather);
    const edgesWithIncidents = this.applyIncidents(edges, input.incidents);
    const { edgesWithTolls, tollsAssigned } = this.applyTolls(edges, input.tolls);

    return {
      edgesWithIncidents,
      edgesWithTolls,
      tollsAssigned,
      tollsUnassigned: input.tolls.length - tollsAssigned,
    };
  }

  private applyWeather(edges: RoadEdge[], weather: RouteWeather): void {
    if (weather.samples.length === 0) return;

    for (const edge of edges) {
      const sample = this.weatherService.nearestSample(weather.samples, midpoint(edge));
      edge.weatherIntensity = sample.intensityFactor;
      edge.weatherCondition = sample.description;
    }
  }

  /**
   * Asigna a cada arco el riesgo del incidente más grave que lo afecta.
   *
   * Se toma el máximo y no la suma: dos accidentes leves en el mismo tramo no equivalen
   * a uno crítico, y sumar penalizaciones haría que el factor superase 1 y rompiese la
   * escala del modelo de costes.
   */
  private applyIncidents(edges: RoadEdge[], incidents: IncidentHit[]): number {
    if (incidents.length === 0) return 0;

    let affected = 0;

    for (const edge of edges) {
      const center = midpoint(edge);
      let worstRisk = 0;
      let worstSeverity = null as IncidentHit['severity'] | null;

      for (const incident of incidents) {
        const distanceKm = haversineDistanceKm(center, incident.coordinates);
        if (distanceKm > incident.affectedRadiusKm) continue;

        if (incident.riskFactor > worstRisk) {
          worstRisk = incident.riskFactor;
          worstSeverity = incident.severity;
        }
      }

      if (worstRisk > 0) {
        edge.riskFactor = worstRisk;
        edge.incidentSeverity = worstSeverity;
        affected += 1;
      }
    }

    if (affected > 0) {
      this.logger.debug(`${affected} arco(s) penalizados por incidentes activos.`);
    }

    return affected;
  }

  /**
   * Imputa cada peaje al arco por el que realmente se pasa.
   *
   * Cada estación se asigna a un único arco —el más cercano a su ubicación— para que el
   * importe no se cobre dos veces si dos arcos consecutivos quedan dentro del radio.
   */
  private applyTolls(
    edges: RoadEdge[],
    tolls: TollHit[],
  ): { edgesWithTolls: number; tollsAssigned: number } {
    const withTolls = new Set<string>();
    let assigned = 0;

    for (const toll of tolls) {
      let bestEdge: RoadEdge | null = null;
      let bestDistanceKm = TOLL_SNAP_RADIUS_KM;

      for (const edge of edges) {
        const distanceKm = distanceToPolylineKm(toll.coordinates, edge.geometry);
        if (distanceKm < bestDistanceKm) {
          bestDistanceKm = distanceKm;
          bestEdge = edge;
        }
      }

      if (!bestEdge) {
        this.logger.debug(
          `Peaje "${toll.name}" descartado: ningún arco pasa a menos de ${TOLL_SNAP_RADIUS_KM} km.`,
        );
        continue;
      }

      bestEdge.tollCost += toll.rateAmount ?? 0;
      bestEdge.tollStationId = toll.stationId;
      withTolls.add(bestEdge.id);
      assigned += 1;
    }

    return { edgesWithTolls: withTolls.size, tollsAssigned: assigned };
  }
}

/** Punto medio geométrico de un arco: el vértice central de su traza. */
function midpoint(edge: RoadEdge): Coordinates {
  const geometry = edge.geometry;
  if (geometry.length === 0) return { latitude: 0, longitude: 0 };
  return geometry[Math.floor(geometry.length / 2)];
}

/**
 * Distancia mínima de un punto a una polilínea, aproximada por la distancia al vértice
 * más próximo.
 *
 * No calcula la distancia perpendicular real al segmento. Con vértices cada pocas
 * decenas de metros —lo que devuelve OSRM— el error es muy inferior al radio de captura
 * de un kilómetro, y evita la proyección punto-segmento en un bucle que se ejecuta
 * (peajes x arcos) veces.
 */
function distanceToPolylineKm(point: Coordinates, polyline: Coordinates[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const vertex of polyline) {
    const distance = haversineDistanceKm(point, vertex);
    if (distance < best) best = distance;
  }
  return best;
}
