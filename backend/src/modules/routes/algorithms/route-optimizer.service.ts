import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { RouteNotFoundException } from '@/common/exceptions/domain.exceptions';
import costModelConfig from '@/config/cost-model.config';

import { AStarAlgorithm } from './astar.algorithm';
import { CostModel, PathMetrics, ScoreBreakdown } from './cost-model';
import { DijkstraAlgorithm } from './dijkstra.algorithm';
import { Path, RoadGraph } from './graph.model';
import { pathOverlapRatio, YenKShortestPaths } from './yen-k-shortest.algorithm';

export interface OptimizationRequest {
  graph: RoadGraph;
  sourceNodeId: string;
  targetNodeId: string;
  /** Consumo efectivo del vehículo, L/100 km. */
  consumptionLPer100Km: number;
  fuelPricePerLiter: number;
  /** Alternativas a devolver además de la óptima. */
  alternativesWanted: number;
  algorithm?: 'dijkstra' | 'astar';
  /** Penaliza fuertemente los tramos de pago sin llegar a prohibirlos. */
  avoidTolls?: boolean;
}

/** Cuánto se multiplica el peaje en la función objetivo cuando el usuario pide evitarlos. */
const TOLL_AVERSION_MULTIPLIER = 25;

export interface OptimizedPath {
  path: Path;
  metrics: PathMetrics;
  score: ScoreBreakdown;
}

export interface OptimizationResult {
  best: OptimizedPath;
  alternatives: OptimizedPath[];
  algorithmUsed: string;
  computationTimeMs: number;
  nodesExplored: number;
}

/**
 * Dos alternativas que comparten más del 75% de su recorrido son, para el conductor,
 * la misma ruta. Se descartan.
 */
const MAX_OVERLAP_RATIO = 0.75;

/**
 * Orquesta la optimización: construye el modelo de costes, ejecuta la búsqueda del
 * camino óptimo y deriva las alternativas.
 */
@Injectable()
export class RouteOptimizerService {
  private readonly logger = new Logger(RouteOptimizerService.name);

  constructor(
    private readonly dijkstra: DijkstraAlgorithm,
    private readonly astar: AStarAlgorithm,
    private readonly yen: YenKShortestPaths,
    @Inject(costModelConfig.KEY) private readonly config: ConfigType<typeof costModelConfig>,
  ) {}

  optimize(request: OptimizationRequest): OptimizationResult {
    const startedAt = process.hrtime.bigint();

    const costModel = new CostModel({
      weights: this.config.weights,
      normalization: this.config.normalization,
      consumptionLPer100Km: request.consumptionLPer100Km,
      fuelPricePerLiter: request.fuelPricePerLiter,
      tollAversionMultiplier: request.avoidTolls ? TOLL_AVERSION_MULTIPLIER : 1,
    });

    // A* por defecto: en una búsqueda punto a punto explora bastantes menos nodos que
    // Dijkstra y devuelve exactamente el mismo óptimo (heurística admisible y consistente).
    const algorithm = request.algorithm === 'dijkstra' ? this.dijkstra : this.astar;

    const totalWanted = Math.max(1, request.alternativesWanted + 1);

    const paths = this.yen.findKShortest(
      request.graph,
      request.sourceNodeId,
      request.targetNodeId,
      costModel,
      totalWanted,
      algorithm,
    );

    if (paths.length === 0) {
      throw new RouteNotFoundException(
        'No se encontró ningún camino entre el origen y el destino en la red vial disponible.',
      );
    }

    const [bestPath, ...rawAlternatives] = paths;

    const best = this.evaluate(bestPath, costModel);

    // Se filtran las variantes que apenas se separan de la ruta principal y se ordenan
    // por puntuación, que es el criterio con el que el usuario las va a comparar.
    const alternatives = rawAlternatives
      .filter((candidate) => pathOverlapRatio(candidate, bestPath) <= MAX_OVERLAP_RATIO)
      .map((candidate) => this.evaluate(candidate, costModel))
      .sort((a, b) => b.score.total - a.score.total);

    const computationTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    if (computationTimeMs > 2000) {
      // RNF-008 fija el objetivo en menos de 2 segundos.
      this.logger.warn(
        `Cálculo de ruta en ${computationTimeMs.toFixed(0)} ms sobre un grafo de ` +
          `${request.graph.nodeCount} nodos y ${request.graph.edgeCount} arcos.`,
      );
    }

    return {
      best,
      alternatives,
      algorithmUsed: algorithm.name,
      computationTimeMs: Math.round(computationTimeMs),
      nodesExplored: request.graph.nodeCount,
    };
  }

  private evaluate(path: Path, costModel: CostModel): OptimizedPath {
    const metrics = costModel.pathMetrics(path);
    return { path, metrics, score: costModel.score(metrics) };
  }
}
