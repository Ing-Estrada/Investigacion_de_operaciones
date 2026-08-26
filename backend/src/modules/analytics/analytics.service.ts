import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role, RouteStatus } from '@/common/enums';
import { AuthenticatedUser } from '@/common/types/authenticated-user';
import { Route } from '@/modules/routes/entities/route.entity';

import { CostByRoadTypeDto, RouteAnalyticsDto, RoutesOverTimeDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(@InjectRepository(Route) private readonly routeRepository: Repository<Route>) {}

  /**
   * Resumen agregado de las rutas del periodo.
   *
   * Todas las agregaciones excluyen las rutas alternativas (`parent_route_id IS NULL`):
   * son escenarios calculados pero no recorridos, y contarlas duplicaría por tres los
   * kilómetros y los costes del informe.
   */
  async summary(user: AuthenticatedUser, days: number): Promise<RouteAnalyticsDto> {
    const since = new Date(Date.now() - days * 86_400_000);
    const scoped = this.scopedQuery(user, since);

    const totals = await scoped
      .select('COUNT(*)', 'total_routes')
      .addSelect('COALESCE(SUM(route.distance_km), 0)', 'total_distance_km')
      .addSelect('COALESCE(SUM(route.fuel_consumption_liters), 0)', 'total_fuel_liters')
      .addSelect('COALESCE(SUM(route.total_cost), 0)', 'total_cost')
      .addSelect('COALESCE(SUM(route.toll_cost), 0)', 'total_toll_cost')
      .addSelect('COALESCE(AVG(route.optimization_score), 0)', 'avg_score')
      .addSelect('COALESCE(AVG(route.estimated_duration_minutes), 0)', 'avg_duration')
      .addSelect('COALESCE(AVG(route.computation_time_ms), 0)', 'avg_computation_ms')
      .getRawOne<Record<string, string>>();

    const byStatus = await this.scopedQuery(user, since)
      .select('route.route_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('route.route_status')
      .getRawMany<{ status: RouteStatus; count: string }>();

    const statusCounts = Object.fromEntries(
      Object.values(RouteStatus).map((status) => [status, 0]),
    ) as Record<RouteStatus, number>;

    for (const row of byStatus) {
      statusCounts[row.status] = Number(row.count);
    }

    return {
      periodDays: days,
      totalRoutes: Number(totals?.total_routes ?? 0),
      totalDistanceKm: round2(Number(totals?.total_distance_km ?? 0)),
      totalFuelLiters: round2(Number(totals?.total_fuel_liters ?? 0)),
      totalCost: round2(Number(totals?.total_cost ?? 0)),
      totalTollCost: round2(Number(totals?.total_toll_cost ?? 0)),
      averageScore: round2(Number(totals?.avg_score ?? 0)),
      averageDurationMinutes: round2(Number(totals?.avg_duration ?? 0)),
      averageComputationTimeMs: round2(Number(totals?.avg_computation_ms ?? 0)),
      routesByStatus: statusCounts,
    };
  }

  /** Serie diaria de rutas, distancia y coste. */
  async overTime(user: AuthenticatedUser, days: number): Promise<RoutesOverTimeDto[]> {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await this.scopedQuery(user, since)
      .select("TO_CHAR(DATE_TRUNC('day', route.created_at), 'YYYY-MM-DD')", 'day')
      .addSelect('COUNT(*)', 'routes')
      .addSelect('COALESCE(SUM(route.distance_km), 0)', 'distance_km')
      .addSelect('COALESCE(SUM(route.total_cost), 0)', 'total_cost')
      .groupBy("DATE_TRUNC('day', route.created_at)")
      .orderBy("DATE_TRUNC('day', route.created_at)", 'ASC')
      .getRawMany<{ day: string; routes: string; distance_km: string; total_cost: string }>();

    return rows.map((row) => ({
      day: row.day,
      routes: Number(row.routes),
      distanceKm: round2(Number(row.distance_km)),
      totalCost: round2(Number(row.total_cost)),
    }));
  }

  /** Distribución de distancia y coste por tipo de vía (RF-010). */
  async costByRoadType(user: AuthenticatedUser, days: number): Promise<CostByRoadTypeDto[]> {
    const since = new Date(Date.now() - days * 86_400_000);

    const query = this.routeRepository
      .createQueryBuilder('route')
      .innerJoin('route.segments', 'segment')
      .where('route.parent_route_id IS NULL')
      .andWhere('route.created_at >= :since', { since });

    if (user.role !== Role.Admin && user.role !== Role.Dispatcher) {
      query.andWhere('route.user_id = :userId', { userId: user.id });
    }

    const rows = await query
      .select('segment.road_type', 'road_type')
      .addSelect('COALESCE(SUM(segment.segment_distance_km), 0)', 'distance_km')
      .addSelect('COALESCE(SUM(segment.toll_cost), 0)', 'toll_cost')
      .addSelect('COUNT(*)', 'segments')
      .groupBy('segment.road_type')
      .orderBy('distance_km', 'DESC')
      .getRawMany<{
        road_type: string;
        distance_km: string;
        toll_cost: string;
        segments: string;
      }>();

    return rows.map((row) => ({
      roadType: row.road_type,
      distanceKm: round2(Number(row.distance_km)),
      tollCost: round2(Number(row.toll_cost)),
      segments: Number(row.segments),
    }));
  }

  /**
   * Base común de las consultas: filtra por periodo, excluye alternativas y restringe
   * al usuario salvo que su rol le permita ver toda la operación.
   */
  private scopedQuery(user: AuthenticatedUser, since: Date) {
    const query = this.routeRepository
      .createQueryBuilder('route')
      .where('route.parent_route_id IS NULL')
      .andWhere('route.created_at >= :since', { since });

    if (user.role !== Role.Admin && user.role !== Role.Dispatcher) {
      query.andWhere('route.user_id = :userId', { userId: user.id });
    }

    return query;
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
