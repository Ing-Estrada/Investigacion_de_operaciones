import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditAction, Role, RouteStatus } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { Coordinates, toGeoJSONPoint } from '@/common/types/geo.types';
import costModelConfig from '@/config/cost-model.config';
import { ROUTING_PROVIDER, RoutingProvider } from '@/external-services/routing/routing.provider';
import { AuditService } from '@/modules/audit/audit.service';
import { IncidentHit, IncidentsService } from '@/modules/incidents/incidents.service';
import { TollHit, TollsService } from '@/modules/tolls/tolls.service';
import { Vehicle } from '@/modules/vehicles/entities/vehicle.entity';
import { VehiclesService } from '@/modules/vehicles/vehicles.service';
import {
  RouteWeather,
  WEATHER_ALERT_THRESHOLD,
  WeatherService,
} from '@/modules/weather/weather.service';

import { OptimizedPath, RouteOptimizerService } from './algorithms/route-optimizer.service';
import {
  LocationDto,
  OptimizeRouteDto,
  OptimizedRouteResponseDto,
  RouteListQueryDto,
  RouteResponseDto,
  RouteSegmentDto,
} from './dto/route.dto';
import { GeoJSONLineString, Route } from './entities/route.entity';
import { RouteSegment } from './entities/route-segment.entity';
import { GraphBuilderService } from './services/graph-builder.service';
import { RouteEnrichmentService } from './services/route-enrichment.service';

const DEFAULT_ALTERNATIVES = 2;

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    @InjectRepository(Route) private readonly routeRepository: Repository<Route>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ROUTING_PROVIDER) private readonly routingProvider: RoutingProvider,
    @Inject(costModelConfig.KEY) private readonly costConfig: ConfigType<typeof costModelConfig>,
    private readonly vehiclesService: VehiclesService,
    private readonly weatherService: WeatherService,
    private readonly incidentsService: IncidentsService,
    private readonly tollsService: TollsService,
    private readonly graphBuilder: GraphBuilderService,
    private readonly enrichment: RouteEnrichmentService,
    private readonly optimizer: RouteOptimizerService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Calcula la ruta óptima y sus alternativas (RF-001 a RF-009).
   *
   * Secuencia: red vial del proveedor -> grafo -> enriquecimiento (clima, incidentes,
   * peajes) -> optimización multicriterio -> validación del vehículo -> persistencia.
   */
  async optimize(
    dto: OptimizeRouteDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<OptimizedRouteResponseDto> {
    const startedAt = Date.now();

    const vehicle = await this.vehiclesService.findOneForUser(dto.vehicleId, user);
    if (!vehicle.isActive) {
      throw new BadRequestException('El vehículo está dado de baja y no puede usarse.');
    }

    const origin: Coordinates = { latitude: dto.origin.latitude, longitude: dto.origin.longitude };
    const destination: Coordinates = {
      latitude: dto.destination.latitude,
      longitude: dto.destination.longitude,
    };

    const alternativesWanted = dto.alternatives ?? DEFAULT_ALTERNATIVES;

    // 1. Red vial real desde el proveedor (RF-002).
    const rawRoutes = await this.routingProvider.fetchRoutes({
      origin,
      destination,
      alternatives: alternativesWanted,
      avoidTolls: dto.avoidTolls,
    });

    // 2. Grafo unificado a partir de todas las trazas.
    const built = this.graphBuilder.build(rawRoutes);

    // 3. Datos externos. Van en paralelo porque son independientes entre sí y son
    //    con diferencia la parte más lenta del cálculo.
    const [weather, incidents, tolls] = await Promise.all([
      this.weatherService.getRouteWeather(built.combinedGeometry),
      this.incidentsService.findAlongPath(built.combinedGeometry),
      this.tollsService.findAlongPath(built.combinedGeometry, vehicle.vehicleType.tollCategory),
    ]);

    // 4. Volcado sobre los arcos: a partir de aquí el peso de cada arco ya incorpora
    //    clima, incidentes y peajes.
    this.enrichment.enrich({ graph: built.graph, weather, incidents, tolls });

    // 5. Optimización multicriterio + alternativas.
    const result = this.optimizer.optimize({
      graph: built.graph,
      sourceNodeId: built.originNodeId,
      targetNodeId: built.destinationNodeId,
      consumptionLPer100Km: vehicle.effectiveConsumptionLPer100Km,
      fuelPricePerLiter: this.costConfig.fuel.defaultPricePerLiter,
      alternativesWanted,
      algorithm: dto.algorithm,
      avoidTolls: dto.avoidTolls,
    });

    // 6. El vehículo tiene que poder pasar por la ruta elegida (RF-014).
    this.vehiclesService.assertCanTraverse(vehicle, result.best.path.edges);

    // 7. Persistencia atómica: la ruta principal y sus alternativas se guardan juntas o
    //    no se guarda ninguna. Si fallara a medias quedarían alternativas huérfanas
    //    apuntando a una ruta que no existe.
    const saved = await this.dataSource.transaction(async (manager) => {
      const primary = await this.persistRoute(manager.getRepository(Route), {
        user,
        vehicle,
        optimized: result.best,
        origin: dto.origin,
        destination: dto.destination,
        weather,
        algorithm: result.algorithmUsed,
        computationTimeMs: result.computationTimeMs,
        parentRouteId: null,
        alternativeRank: null,
      });

      const alternatives: Route[] = [];
      for (const [index, alternative] of result.alternatives.entries()) {
        alternatives.push(
          await this.persistRoute(manager.getRepository(Route), {
            user,
            vehicle,
            optimized: alternative,
            origin: dto.origin,
            destination: dto.destination,
            weather,
            algorithm: result.algorithmUsed,
            computationTimeMs: result.computationTimeMs,
            parentRouteId: primary.id,
            alternativeRank: index + 1,
          }),
        );
      }

      return { primary, alternatives };
    });

    await this.auditService.record({
      action: AuditAction.Create,
      entityType: 'route',
      entityId: saved.primary.id,
      userId: user.id,
      userEmail: user.email,
      newValues: {
        vehicleId: vehicle.id,
        distanceKm: saved.primary.distanceKm,
        totalCost: saved.primary.totalCost,
        alternatives: saved.alternatives.length,
      },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    const elapsed = Date.now() - startedAt;
    this.logger.log(
      `Ruta ${saved.primary.id} calculada en ${elapsed} ms ` +
        `(optimización: ${result.computationTimeMs} ms, ${result.alternatives.length} alternativas).`,
    );

    return {
      route: this.toResponse(saved.primary, result.best, dto, weather, tolls, incidents),
      alternatives: saved.alternatives.map((route, index) =>
        this.toResponse(route, result.alternatives[index], dto, weather, tolls, incidents),
      ),
    };
  }

  async findAllForUser(
    user: AuthenticatedUser,
    query: RouteListQueryDto,
  ): Promise<{ items: RouteResponseDto[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = Math.min(100, query.limit ?? 20);

    const canSeeAll = user.role === Role.Admin || user.role === Role.Dispatcher;

    const builder = this.routeRepository
      .createQueryBuilder('route')
      .leftJoinAndSelect('route.segments', 'segment')
      // Solo rutas principales: las alternativas se devuelven anidadas en su ruta padre,
      // no como entradas sueltas del historial.
      .where('route.parent_route_id IS NULL');

    if (!canSeeAll) {
      builder.andWhere('route.user_id = :userId', { userId: user.id });
    }

    if (query.status) {
      builder.andWhere('route.route_status = :status', { status: query.status });
    }

    const [routes, total] = await builder
      .orderBy('route.created_at', 'DESC')
      .addOrderBy('segment.segment_order', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: routes.map((route) => this.entityToResponse(route)), total, page, limit };
  }

  async findOneForUser(id: string, user: AuthenticatedUser): Promise<OptimizedRouteResponseDto> {
    const route = await this.routeRepository.findOne({
      where: { id },
      relations: { segments: true, alternatives: { segments: true } },
      order: { segments: { segmentOrder: 'ASC' } },
    });

    if (!route) throw new NotFoundException('Ruta no encontrada.');

    const canSeeAll = user.role === Role.Admin || user.role === Role.Dispatcher;
    if (!canSeeAll && route.userId !== user.id) {
      throw new NotFoundException('Ruta no encontrada.');
    }

    return {
      route: this.entityToResponse(route),
      alternatives: (route.alternatives ?? [])
        .sort((a, b) => (a.alternativeRank ?? 0) - (b.alternativeRank ?? 0))
        .map((alternative) => this.entityToResponse(alternative)),
    };
  }

  async updateStatus(
    id: string,
    status: RouteStatus,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<RouteResponseDto> {
    const route = await this.routeRepository.findOne({
      where: { id },
      relations: { segments: true },
    });
    if (!route) throw new NotFoundException('Ruta no encontrada.');

    const canManage =
      user.role === Role.Admin || user.role === Role.Dispatcher || route.userId === user.id;
    if (!canManage) throw new NotFoundException('Ruta no encontrada.');

    const previous = route.routeStatus;
    route.routeStatus = status;
    const saved = await this.routeRepository.save(route);

    await this.auditService.record({
      action: AuditAction.Update,
      entityType: 'route',
      entityId: saved.id,
      userId: user.id,
      userEmail: user.email,
      oldValues: { routeStatus: previous },
      newValues: { routeStatus: status },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return this.entityToResponse(saved);
  }

  // --- Persistencia -----------------------------------------------------------

  private async persistRoute(
    repository: Repository<Route>,
    params: {
      user: AuthenticatedUser;
      vehicle: Vehicle;
      optimized: OptimizedPath;
      origin: LocationDto;
      destination: LocationDto;
      weather: RouteWeather;
      algorithm: string;
      computationTimeMs: number;
      parentRouteId: string | null;
      alternativeRank: number | null;
    },
  ): Promise<Route> {
    const { optimized } = params;
    const metrics = optimized.metrics;

    const geometry = flattenGeometry(optimized);

    const route = repository.create({
      userId: params.user.id,
      vehicleId: params.vehicle.id,
      parentRouteId: params.parentRouteId,
      alternativeRank: params.alternativeRank,
      originPoint: toGeoJSONPoint(params.origin),
      destinationPoint: toGeoJSONPoint(params.destination),
      path: toLineString(geometry),
      originAddress: params.origin.address ?? null,
      destinationAddress: params.destination.address ?? null,
      distanceKm: round2(metrics.distanceKm),
      // Se redondea al alza: informar 0 minutos para un trayecto de 40 segundos violaría
      // el CHECK de duración positiva y además no tiene sentido para el usuario.
      estimatedDurationMinutes: Math.max(1, Math.round(metrics.durationMinutes)),
      fuelConsumptionLiters: round2(metrics.fuelLiters),
      fuelCost: round2(metrics.fuelCost),
      tollCost: round2(metrics.tollCost),
      totalCost: round2(metrics.totalCost),
      currency: this.costConfig.fuel.currency,
      optimizationScore: optimized.score.total,
      algorithm: params.algorithm,
      routeStatus: RouteStatus.Calculated,
      computationTimeMs: params.computationTimeMs,
      weatherSummary: {
        worstIntensity: round2(params.weather.worstIntensity),
        averageIntensity: round2(params.weather.averageIntensity),
        conditions: params.weather.conditions,
        degraded: params.weather.degraded,
      },
    });

    const saved = await repository.save(route);

    const segmentRepository = repository.manager.getRepository(RouteSegment);
    const segments = optimized.path.edges
      // Los arcos de coste cero son las costuras que añade el constructor del grafo para
      // unir tramos: son un detalle interno, no un tramo real que mostrar al conductor.
      .filter((edge) => edge.distanceKm > 0)
      .map((edge, index) =>
        segmentRepository.create({
          routeId: saved.id,
          segmentOrder: index,
          startPoint: toGeoJSONPoint(edge.geometry[0]),
          endPoint: toGeoJSONPoint(edge.geometry[edge.geometry.length - 1]),
          segmentDistanceKm: round2(edge.distanceKm),
          segmentDurationMinutes: round2(edge.baseDurationMinutes),
          roadType: edge.roadType,
          roadName: edge.roadName ?? null,
          hasToll: edge.tollCost > 0,
          tollCost: edge.tollCost > 0 ? round2(edge.tollCost) : null,
          tollStationId: edge.tollStationId ?? null,
          weatherCondition: edge.weatherCondition ?? null,
          weatherIntensityFactor: edge.weatherIntensity,
          incidentPresent: edge.riskFactor > 0,
          incidentSeverity: edge.incidentSeverity ?? null,
        }),
      );

    if (segments.length > 0) {
      await segmentRepository.save(segments);
    }

    saved.segments = segments;
    return saved;
  }

  // --- Mapeo a DTO ------------------------------------------------------------

  private toResponse(
    entity: Route,
    optimized: OptimizedPath,
    dto: OptimizeRouteDto,
    weather: RouteWeather,
    tolls: TollHit[],
    incidents: IncidentHit[],
  ): RouteResponseDto {
    const usedTollStationIds = new Set(
      optimized.path.edges.map((edge) => edge.tollStationId).filter(Boolean) as string[],
    );

    const geometry = flattenGeometry(optimized);

    return {
      id: entity.id,
      parentRouteId: entity.parentRouteId,
      alternativeRank: entity.alternativeRank,
      distanceKm: entity.distanceKm,
      durationMinutes: entity.estimatedDurationMinutes,
      cost: {
        fuelLiters: entity.fuelConsumptionLiters,
        fuelCost: entity.fuelCost,
        tollCost: entity.tollCost,
        totalCost: entity.totalCost,
        currency: entity.currency,
        fuelPricePerLiter: this.costConfig.fuel.defaultPricePerLiter,
      },
      score: optimized.score,
      origin: dto.origin,
      destination: dto.destination,
      geometry: geometry.map((point) => [point.latitude, point.longitude] as [number, number]),
      segments: (entity.segments ?? []).map((segment, index) =>
        this.segmentToDto(segment, index, optimized),
      ),
      // Solo los peajes que la ruta elegida atraviesa realmente: la consulta espacial
      // devolvió los de todas las alternativas.
      tollBreakdown: tolls
        .filter((toll) => usedTollStationIds.has(toll.stationId))
        .map((toll) => ({
          stationId: toll.stationId,
          name: toll.name,
          highwayName: toll.highwayName,
          amount: toll.rateAmount,
          latitude: toll.coordinates.latitude,
          longitude: toll.coordinates.longitude,
        })),
      incidents: incidents.map((incident) => ({
        id: incident.id,
        incidentType: incident.incidentType,
        severity: incident.severity,
        description: incident.description,
        latitude: incident.coordinates.latitude,
        longitude: incident.coordinates.longitude,
      })),
      weather: {
        worstIntensity: round2(weather.worstIntensity),
        averageIntensity: round2(weather.averageIntensity),
        conditions: weather.conditions,
        alert: weather.worstIntensity >= WEATHER_ALERT_THRESHOLD,
        degraded: weather.degraded,
      },
      status: entity.routeStatus,
      algorithm: entity.algorithm,
      computationTimeMs: entity.computationTimeMs,
      createdAt: entity.createdAt,
    };
  }

  private segmentToDto(
    segment: RouteSegment,
    index: number,
    optimized?: OptimizedPath,
  ): RouteSegmentDto {
    const edge = optimized?.path.edges.filter((e) => e.distanceKm > 0)[index];

    return {
      order: segment.segmentOrder,
      distanceKm: segment.segmentDistanceKm,
      durationMinutes: segment.segmentDurationMinutes,
      roadType: segment.roadType,
      roadName: segment.roadName,
      hasToll: segment.hasToll,
      tollCost: segment.tollCost,
      weatherCondition: segment.weatherCondition,
      weatherIntensityFactor: segment.weatherIntensityFactor,
      incidentPresent: segment.incidentPresent,
      incidentSeverity: segment.incidentSeverity,
      geometry: (edge?.geometry ?? []).map(
        (point) => [point.latitude, point.longitude] as [number, number],
      ),
    };
  }

  /** Mapeo desde una ruta ya persistida, sin los datos vivos del cálculo. */
  private entityToResponse(entity: Route): RouteResponseDto {
    const summary = (entity.weatherSummary ?? {}) as Record<string, unknown>;
    const worstIntensity = Number(summary.worstIntensity ?? 0);

    const segments = [...(entity.segments ?? [])].sort((a, b) => a.segmentOrder - b.segmentOrder);

    return {
      id: entity.id,
      parentRouteId: entity.parentRouteId,
      alternativeRank: entity.alternativeRank,
      distanceKm: entity.distanceKm,
      durationMinutes: entity.estimatedDurationMinutes,
      cost: {
        fuelLiters: entity.fuelConsumptionLiters,
        fuelCost: entity.fuelCost,
        tollCost: entity.tollCost,
        totalCost: entity.totalCost,
        currency: entity.currency,
        fuelPricePerLiter: this.costConfig.fuel.defaultPricePerLiter,
      },
      score: {
        distanceScore: 0,
        timeScore: 0,
        costScore: 0,
        safetyScore: 0,
        total: entity.optimizationScore,
      },
      origin: {
        latitude: entity.originPoint.coordinates[1],
        longitude: entity.originPoint.coordinates[0],
        address: entity.originAddress ?? undefined,
      },
      destination: {
        latitude: entity.destinationPoint.coordinates[1],
        longitude: entity.destinationPoint.coordinates[0],
        address: entity.destinationAddress ?? undefined,
      },
      geometry: (entity.path?.coordinates ?? []).map(
        ([longitude, latitude]) => [latitude, longitude] as [number, number],
      ),
      segments: segments.map((segment) => this.segmentToDto(segment, segment.segmentOrder)),
      tollBreakdown: [],
      incidents: [],
      weather: {
        worstIntensity,
        averageIntensity: Number(summary.averageIntensity ?? 0),
        conditions: (summary.conditions as string[]) ?? [],
        alert: worstIntensity >= WEATHER_ALERT_THRESHOLD,
        degraded: Boolean(summary.degraded),
      },
      status: entity.routeStatus,
      algorithm: entity.algorithm,
      computationTimeMs: entity.computationTimeMs,
      createdAt: entity.createdAt,
    };
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Concatena la geometría de los arcos evitando duplicar el vértice compartido. */
function flattenGeometry(optimized: OptimizedPath): Coordinates[] {
  const points: Coordinates[] = [];

  for (const edge of optimized.path.edges) {
    for (const point of edge.geometry) {
      const last = points[points.length - 1];
      if (last && last.latitude === point.latitude && last.longitude === point.longitude) continue;
      points.push(point);
    }
  }

  return points;
}

function toLineString(points: Coordinates[]): GeoJSONLineString | null {
  if (points.length < 2) return null;
  return {
    type: 'LineString',
    coordinates: points.map((point) => [point.longitude, point.latitude] as [number, number]),
  };
}
