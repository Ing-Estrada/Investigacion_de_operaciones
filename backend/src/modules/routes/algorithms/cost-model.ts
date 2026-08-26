import { Path, RoadEdge } from './graph.model';

export interface CostWeights {
  distance: number;
  time: number;
  cost: number;
  risk: number;
}

export interface Normalization {
  distanceKm: number;
  timeMinutes: number;
  costUnits: number;
}

export interface CostContext {
  weights: CostWeights;
  normalization: Normalization;
  /** Consumo del vehículo en litros por 100 km (RF-013). */
  consumptionLPer100Km: number;
  fuelPricePerLiter: number;
  /**
   * Aversión a los peajes. 1 = neutral. Con valores mayores, el peaje pesa más en la
   * *decisión* sin alterar el importe que se *informa*: es una preferencia del usuario,
   * no un cambio en el precio real. Se usa para `avoidTolls`.
   *
   * Se implementa como penalización y no como prohibición porque bloquear todas las
   * vías de pago puede dejar el destino inalcanzable, y devolver "no hay ruta" es peor
   * respuesta que "esta ruta tiene un peaje".
   */
  tollAversionMultiplier?: number;
}

export interface PathMetrics {
  distanceKm: number;
  durationMinutes: number;
  fuelLiters: number;
  fuelCost: number;
  tollCost: number;
  totalCost: number;
  /** Riesgo medio ponderado por distancia, 0-1. */
  riskFactor: number;
}

export interface ScoreBreakdown {
  distanceScore: number;
  timeScore: number;
  costScore: number;
  safetyScore: number;
  total: number;
}

/**
 * Cuánto alarga el tiempo de viaje la meteorología adversa, como fracción de la
 * duración base cuando `weatherIntensity` vale 1 (lluvia fuerte + viento + hielo).
 */
const WEATHER_TIME_IMPACT = 0.35;

/** Lo mismo para los incidentes: un incidente crítico casi duplica el tiempo del tramo. */
const INCIDENT_TIME_IMPACT = 0.9;

/**
 * Modelo de costes multicriterio (RF-003).
 *
 * El problema real es multiobjetivo: la ruta más corta, la más rápida y la más barata
 * rara vez son la misma. Se resuelve por suma ponderada (weighted sum scalarization),
 * que convierte los cuatro objetivos en un escalar y permite aplicar Dijkstra.
 *
 * Los cuatro términos se normalizan antes de sumarse. Sin normalizar, sumar kilómetros
 * con minutos y con dólares hace que el criterio de mayor magnitud numérica domine el
 * resultado con independencia de su peso: los pesos dejarían de significar nada.
 *
 * Requisito que hay que preservar: el peso de un arco nunca puede ser negativo, o
 * Dijkstra deja de ser correcto. Todos los términos son magnitudes no negativas
 * multiplicadas por pesos no negativos, así que la propiedad se cumple por construcción.
 */
export class CostModel {
  constructor(private readonly context: CostContext) {
    const { distance, time, cost, risk } = context.weights;

    if ([distance, time, cost, risk].some((w) => w < 0)) {
      throw new Error('Los pesos del modelo multicriterio no pueden ser negativos.');
    }

    const sum = distance + time + cost + risk;
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`Los pesos deben sumar 1.0; suman ${sum.toFixed(4)}.`);
    }
  }

  /** Duración real del tramo incorporando clima e incidentes. */
  effectiveDurationMinutes(edge: RoadEdge): number {
    const weatherPenalty = edge.weatherIntensity * WEATHER_TIME_IMPACT;
    const incidentPenalty = edge.riskFactor * INCIDENT_TIME_IMPACT;
    return edge.baseDurationMinutes * (1 + weatherPenalty + incidentPenalty);
  }

  /**
   * Consumo del tramo (RF-005).
   *
   * `litros = (consumo/100) x km x (1 + factor_climático)`. El factor climático recoge
   * lluvia, viento en contra, frío y la resistencia añadida del firme mojado.
   */
  fuelLiters(edge: RoadEdge): number {
    const base = (this.context.consumptionLPer100Km / 100) * edge.distanceKm;
    return base * (1 + edge.weatherIntensity);
  }

  /** Coste monetario real del tramo: combustible + peaje (RF-006). Es lo que se informa. */
  monetaryCost(edge: RoadEdge): number {
    return this.fuelLiters(edge) * this.context.fuelPricePerLiter + edge.tollCost;
  }

  /** Coste que ve el optimizador, con la aversión a peajes aplicada. */
  private optimizationCost(edge: RoadEdge): number {
    const aversion = this.context.tollAversionMultiplier ?? 1;
    return this.fuelLiters(edge) * this.context.fuelPricePerLiter + edge.tollCost * aversion;
  }

  /**
   * Peso escalar del arco. Es la función objetivo que minimiza la búsqueda.
   * Siempre ≥ 0 (ver nota de clase).
   */
  edgeWeight(edge: RoadEdge): number {
    const { weights, normalization } = this.context;

    const distanceTerm = edge.distanceKm / normalization.distanceKm;
    const timeTerm = this.effectiveDurationMinutes(edge) / normalization.timeMinutes;
    const costTerm = this.optimizationCost(edge) / normalization.costUnits;

    return (
      weights.distance * distanceTerm +
      weights.time * timeTerm +
      weights.cost * costTerm +
      weights.risk * edge.riskFactor
    );
  }

  /**
   * Cota inferior del coste que queda desde un punto al destino, dada la distancia en
   * línea recta. Es la heurística `h` de A*.
   *
   * Solo incluye los términos que se pueden acotar por debajo con seguridad:
   *  - distancia: la real por carretera nunca es menor que la del gran círculo;
   *  - tiempo: no se puede cubrir esa distancia más rápido que a `maxSpeedKmh`.
   * Coste y riesgo se omiten porque su mínimo es 0 (una ruta sin peajes ni incidentes),
   * y sobreestimar rompería la admisibilidad y con ella la optimalidad de A*.
   */
  heuristic(straightLineKm: number, maxSpeedKmh: number): number {
    const { weights, normalization } = this.context;

    const distanceTerm = straightLineKm / normalization.distanceKm;
    const minimumMinutes = (straightLineKm / Math.max(maxSpeedKmh, 1)) * 60;
    const timeTerm = minimumMinutes / normalization.timeMinutes;

    return weights.distance * distanceTerm + weights.time * timeTerm;
  }

  /** Métricas agregadas de un camino completo. */
  pathMetrics(path: Path): PathMetrics {
    let distanceKm = 0;
    let durationMinutes = 0;
    let fuelLiters = 0;
    let tollCost = 0;
    let riskWeightedByDistance = 0;

    for (const edge of path.edges) {
      distanceKm += edge.distanceKm;
      durationMinutes += this.effectiveDurationMinutes(edge);
      fuelLiters += this.fuelLiters(edge);
      tollCost += edge.tollCost;
      riskWeightedByDistance += edge.riskFactor * edge.distanceKm;
    }

    const fuelCost = fuelLiters * this.context.fuelPricePerLiter;

    return {
      distanceKm,
      durationMinutes,
      fuelLiters,
      fuelCost,
      tollCost,
      totalCost: fuelCost + tollCost,
      // Ponderado por distancia: un incidente en 500 m de una ruta de 300 km no debe
      // pesar lo mismo que uno que afecta a la mitad del trayecto.
      riskFactor: distanceKm > 0 ? riskWeightedByDistance / distanceKm : 0,
    };
  }

  /**
   * Puntuación 0-100 de una ruta, para ordenar alternativas de cara al usuario.
   *
   * Cada criterio se satura en su escala de normalización en lugar de crecer sin
   * límite: sin ese recorte, una ruta más larga que la escala produciría una puntuación
   * negativa y el ranking dejaría de tener sentido.
   */
  score(metrics: PathMetrics): ScoreBreakdown {
    const { weights, normalization } = this.context;

    const ratio = (value: number, scale: number) => Math.min(1, Math.max(0, value / scale));

    const distanceScore = 100 * (1 - ratio(metrics.distanceKm, normalization.distanceKm));
    const timeScore = 100 * (1 - ratio(metrics.durationMinutes, normalization.timeMinutes));
    const costScore = 100 * (1 - ratio(metrics.totalCost, normalization.costUnits));
    const safetyScore = 100 * (1 - Math.min(1, Math.max(0, metrics.riskFactor)));

    const total =
      weights.distance * distanceScore +
      weights.time * timeScore +
      weights.cost * costScore +
      weights.risk * safetyScore;

    return {
      distanceScore: round2(distanceScore),
      timeScore: round2(timeScore),
      costScore: round2(costScore),
      safetyScore: round2(safetyScore),
      total: round2(total),
    };
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
