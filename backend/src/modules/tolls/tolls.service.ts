import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditAction, TollCategory } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { Coordinates, toGeoJSONPoint } from '@/common/types/geo.types';
import { toLineStringWkt } from '@/common/utils/wkt';
import { AuditService } from '@/modules/audit/audit.service';

import {
  CreateTollRateDto,
  CreateTollStationDto,
  UpdateTollRateDto,
  UpdateTollStationDto,
} from './dto/toll-admin.dto';
import { TollRate } from './entities/toll-rate.entity';
import { TollStation } from './entities/toll-station.entity';

export interface TollHit {
  stationId: string;
  name: string;
  highwayName: string;
  operator: string | null;
  coordinates: Coordinates;
  /** Distancia de la estación a la traza de la ruta, en metros. */
  distanceMeters: number;
  /** Importe aplicable, o null si no hay tarifa vigente para esa categoría. */
  rateAmount: number | null;
  currency: string | null;
}

/**
 * Radio de captura alrededor de la traza.
 *
 * 500 m y no los 5 km que sugería la especificación: con la geometría precisa que
 * devuelve el proveedor de rutas, un radio de kilómetros captura peajes de carreteras
 * paralelas por las que el vehículo no pasa, y cobrarlos infla el coste estimado.
 */
const DEFAULT_RADIUS_METERS = 500;

interface TollRow {
  station_id: string;
  name: string;
  highway_name: string;
  operator: string | null;
  longitude: string;
  latitude: string;
  distance_meters: string;
  rate_amount: string | null;
  currency: string | null;
}

@Injectable()
export class TollsService {
  private readonly logger = new Logger(TollsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TollStation) private readonly stationRepository: Repository<TollStation>,
    @InjectRepository(TollRate) private readonly rateRepository: Repository<TollRate>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Estaciones de peaje que atraviesa una ruta, con la tarifa vigente para la categoría
   * del vehículo (RF-009, RF-015).
   *
   * Se resuelve en una sola consulta con `ST_DWithin` sobre `geography` (distancias en
   * metros reales, no en grados) y un LATERAL que selecciona la tarifa vigente más
   * reciente por estación. Hacerlo en dos pasos —estaciones primero, tarifas después—
   * provocaría N+1 consultas en una ruta con veinte peajes.
   */
  async findAlongPath(
    geometry: Coordinates[],
    category: TollCategory,
    radiusMeters: number = DEFAULT_RADIUS_METERS,
  ): Promise<TollHit[]> {
    const wkt = toLineStringWkt(geometry);
    if (!wkt) return [];

    const rows: TollRow[] = await this.dataSource.query(
      `
      SELECT
        s.id                                   AS station_id,
        s.name                                 AS name,
        s.highway_name                         AS highway_name,
        s.operator                             AS operator,
        ST_X(s.location)                       AS longitude,
        ST_Y(s.location)                       AS latitude,
        ST_Distance(s.location::geography, route.geog) AS distance_meters,
        r.rate_amount                          AS rate_amount,
        r.currency                             AS currency
      FROM toll_stations s
      CROSS JOIN (SELECT ST_GeogFromText($1) AS geog) AS route
      LEFT JOIN LATERAL (
        SELECT tr.rate_amount, tr.currency
        FROM toll_rates tr
        WHERE tr.toll_station_id = s.id
          AND tr.vehicle_category = $2
          AND tr.effective_date <= CURRENT_DATE
          AND (tr.expiration_date IS NULL OR tr.expiration_date >= CURRENT_DATE)
        ORDER BY tr.effective_date DESC
        LIMIT 1
      ) r ON TRUE
      WHERE s.is_active = true
        AND ST_DWithin(s.location::geography, route.geog, $3)
      ORDER BY distance_meters ASC
      `,
      [wkt, category, radiusMeters],
    );

    const hits = rows.map((row) => ({
      stationId: row.station_id,
      name: row.name,
      highwayName: row.highway_name,
      operator: row.operator,
      coordinates: {
        latitude: Number.parseFloat(row.latitude),
        longitude: Number.parseFloat(row.longitude),
      },
      distanceMeters: Number.parseFloat(row.distance_meters),
      rateAmount: row.rate_amount === null ? null : Number.parseFloat(row.rate_amount),
      currency: row.currency,
    }));

    // Una estación sin tarifa se cuenta como 0, pero se avisa: es un hueco en los datos
    // maestros que hace que el coste estimado sea menor que el real.
    const missing = hits.filter((hit) => hit.rateAmount === null);
    if (missing.length > 0) {
      this.logger.warn(
        `${missing.length} estación(es) sin tarifa vigente para la categoría ${category}: ` +
          missing.map((hit) => hit.name).join(', '),
      );
    }

    return hits;
  }

  /** Coste total de peajes de una lista de estaciones. */
  totalCost(hits: TollHit[]): number {
    return hits.reduce((sum, hit) => sum + (hit.rateAmount ?? 0), 0);
  }

  /** Estaciones cercanas a un punto, para pintarlas en el mapa. */
  async findNearby(
    center: Coordinates,
    radiusMeters: number,
    category?: TollCategory,
  ): Promise<TollHit[]> {
    const rows: TollRow[] = await this.dataSource.query(
      `
      SELECT
        s.id AS station_id,
        s.name AS name,
        s.highway_name AS highway_name,
        s.operator AS operator,
        ST_X(s.location) AS longitude,
        ST_Y(s.location) AS latitude,
        ST_Distance(s.location::geography, center.geog) AS distance_meters,
        r.rate_amount AS rate_amount,
        r.currency AS currency
      FROM toll_stations s
      CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS geog) AS center
      LEFT JOIN LATERAL (
        SELECT tr.rate_amount, tr.currency
        FROM toll_rates tr
        WHERE tr.toll_station_id = s.id
          -- Se compara como texto para no depender del nombre que Postgres da al tipo enum.
          AND ($4::text IS NULL OR tr.vehicle_category::text = $4::text)
          AND tr.effective_date <= CURRENT_DATE
          AND (tr.expiration_date IS NULL OR tr.expiration_date >= CURRENT_DATE)
        ORDER BY tr.effective_date DESC
        LIMIT 1
      ) r ON TRUE
      WHERE s.is_active = true
        AND ST_DWithin(s.location::geography, center.geog, $3)
      ORDER BY distance_meters ASC
      LIMIT 200
      `,
      [center.longitude, center.latitude, radiusMeters, category ?? null],
    );

    return rows.map((row) => ({
      stationId: row.station_id,
      name: row.name,
      highwayName: row.highway_name,
      operator: row.operator,
      coordinates: {
        latitude: Number.parseFloat(row.latitude),
        longitude: Number.parseFloat(row.longitude),
      },
      distanceMeters: Number.parseFloat(row.distance_meters),
      rateAmount: row.rate_amount === null ? null : Number.parseFloat(row.rate_amount),
      currency: row.currency,
    }));
  }

  // ---------------------------------------------------------------------------
  // Gestión de datos maestros. El coste informado es tan bueno como estos datos:
  // sin una vía para mantenerlos, el sistema queda atado a lo que trajo el seeder.
  // ---------------------------------------------------------------------------

  /** Estaciones con sus tarifas, para la pantalla de administración de tarifas. */
  async listStations(includeInactive = false): Promise<TollStation[]> {
    return this.stationRepository.find({
      where: includeInactive ? {} : { isActive: true },
      relations: { rates: true },
      order: { name: 'ASC' },
    });
  }

  async findStation(id: string): Promise<TollStation> {
    const station = await this.stationRepository.findOne({
      where: { id },
      relations: { rates: true },
    });
    if (!station) throw new NotFoundException('Estación de peaje no encontrada.');
    return station;
  }

  async createStation(
    dto: CreateTollStationDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<TollStation> {
    const saved = await this.stationRepository.save(
      this.stationRepository.create({
        name: dto.name,
        highwayName: dto.highwayName,
        operator: dto.operator ?? null,
        location: toGeoJSONPoint({ latitude: dto.latitude, longitude: dto.longitude }),
        isActive: true,
      }),
    );

    await this.audit(AuditAction.Create, 'toll_station', saved.id, user, request, undefined, {
      name: saved.name,
      highwayName: saved.highwayName,
    });

    return this.findStation(saved.id);
  }

  async updateStation(
    id: string,
    dto: UpdateTollStationDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<TollStation> {
    const station = await this.findStation(id);
    const oldValues = {
      name: station.name,
      highwayName: station.highwayName,
      isActive: station.isActive,
    };

    if (dto.name !== undefined) station.name = dto.name;
    if (dto.highwayName !== undefined) station.highwayName = dto.highwayName;
    if (dto.operator !== undefined) station.operator = dto.operator;
    if (dto.isActive !== undefined) station.isActive = dto.isActive;

    // Ambas coordenadas o ninguna: aceptar solo una movería la estación a un punto que
    // el usuario no ha elegido, mezclando la latitud nueva con la longitud vieja.
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException(
          'Para mover la estación hay que indicar latitud y longitud a la vez.',
        );
      }
      station.location = toGeoJSONPoint({ latitude: dto.latitude, longitude: dto.longitude });
    }

    await this.stationRepository.save(station);
    await this.audit(AuditAction.Update, 'toll_station', id, user, request, oldValues, { ...dto });

    return this.findStation(id);
  }

  async createRate(
    stationId: string,
    dto: CreateTollRateDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<TollRate> {
    await this.findStation(stationId);

    if (dto.expirationDate && dto.expirationDate < dto.effectiveDate) {
      throw new BadRequestException(
        'La fecha de caducidad no puede ser anterior a la de entrada en vigor.',
      );
    }

    // La restricción UNIQUE ya lo impide; comprobarlo aquí convierte el 500 por
    // violación de constraint en un 400 que explica qué pasa.
    const clash = await this.rateRepository.findOne({
      where: {
        tollStationId: stationId,
        vehicleCategory: dto.vehicleCategory,
        effectiveDate: dto.effectiveDate,
      },
    });
    if (clash) {
      throw new BadRequestException(
        `Ya existe una tarifa de categoría ${dto.vehicleCategory} con vigencia ${dto.effectiveDate} en esta estación.`,
      );
    }

    const saved = await this.rateRepository.save(
      this.rateRepository.create({
        tollStationId: stationId,
        vehicleCategory: dto.vehicleCategory,
        rateAmount: dto.rateAmount,
        currency: dto.currency ?? 'USD',
        effectiveDate: dto.effectiveDate,
        expirationDate: dto.expirationDate ?? null,
      }),
    );

    await this.audit(AuditAction.Create, 'toll_rate', saved.id, user, request, undefined, {
      tollStationId: stationId,
      vehicleCategory: saved.vehicleCategory,
      rateAmount: saved.rateAmount,
    });

    return saved;
  }

  async updateRate(
    rateId: string,
    dto: UpdateTollRateDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<TollRate> {
    const rate = await this.rateRepository.findOne({ where: { id: rateId } });
    if (!rate) throw new NotFoundException('Tarifa de peaje no encontrada.');

    const oldValues = { rateAmount: rate.rateAmount, expirationDate: rate.expirationDate };

    if (dto.rateAmount !== undefined) rate.rateAmount = dto.rateAmount;
    if (dto.expirationDate !== undefined) rate.expirationDate = dto.expirationDate;

    if (rate.expirationDate && rate.expirationDate < rate.effectiveDate) {
      throw new BadRequestException(
        'La fecha de caducidad no puede ser anterior a la de entrada en vigor.',
      );
    }

    const saved = await this.rateRepository.save(rate);
    await this.audit(AuditAction.Update, 'toll_rate', rateId, user, request, oldValues, {
      ...dto,
    });

    return saved;
  }

  private async audit(
    action: AuditAction,
    entityType: string,
    entityId: string,
    user: AuthenticatedUser,
    request: RequestWithUser,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      action,
      entityType,
      entityId,
      userId: user.id,
      userEmail: user.email,
      oldValues,
      newValues,
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
