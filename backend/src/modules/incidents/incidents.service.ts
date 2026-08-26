import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  AuditAction,
  IncidentSeverity,
  IncidentType,
  INCIDENT_SEVERITY_PENALTY,
} from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { Coordinates, toGeoJSONPoint } from '@/common/types/geo.types';
import { toLineStringWkt } from '@/common/utils/wkt';
import { AuditService } from '@/modules/audit/audit.service';

import { CreateIncidentDto, UpdateIncidentDto } from './dto/incident.dto';
import { RoadIncident } from './entities/road-incident.entity';

export interface IncidentHit {
  id: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  description: string;
  coordinates: Coordinates;
  distanceMeters: number;
  affectedRadiusKm: number;
  startTime: Date;
  estimatedEndTime: Date | null;
  /** Penalización 0-1 derivada de la severidad. */
  riskFactor: number;
}

interface IncidentRow {
  id: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  description: string;
  longitude: string;
  latitude: string;
  distance_meters: string;
  affected_radius_km: string;
  start_time: Date;
  estimated_end_time: Date | null;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(RoadIncident) private readonly repository: Repository<RoadIncident>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Incidentes activos que afectan a una ruta (RF-008).
   *
   * El radio de búsqueda es el `affected_radius_km` de cada incidente, no una constante:
   * un accidente puntual afecta a 500 m y un temporal a 20 km, y aplicarles el mismo
   * radio significa o ignorar el segundo o inventarse el primero.
   *
   * La ventana temporal filtra los incidentes ya resueltos: un accidente de hace tres
   * días no debe seguir penalizando la ruta.
   */
  async findAlongPath(geometry: Coordinates[]): Promise<IncidentHit[]> {
    const wkt = toLineStringWkt(geometry);
    if (!wkt) return [];

    const rows: IncidentRow[] = await this.dataSource.query(
      `
      SELECT
        i.id                 AS id,
        i.incident_type      AS incident_type,
        i.severity           AS severity,
        i.description        AS description,
        ST_X(i.incident_location) AS longitude,
        ST_Y(i.incident_location) AS latitude,
        ST_Distance(i.incident_location::geography, route.geog) AS distance_meters,
        i.affected_radius_km AS affected_radius_km,
        i.start_time         AS start_time,
        i.estimated_end_time AS estimated_end_time
      FROM road_incidents i
      CROSS JOIN (SELECT ST_GeogFromText($1) AS geog) AS route
      WHERE i.is_active = true
        AND i.start_time <= NOW()
        AND (i.estimated_end_time IS NULL OR i.estimated_end_time >= NOW())
        AND ST_DWithin(i.incident_location::geography, route.geog, i.affected_radius_km * 1000)
      ORDER BY i.severity DESC, distance_meters ASC
      `,
      [wkt],
    );

    return rows.map((row) => ({
      id: row.id,
      incidentType: row.incident_type,
      severity: row.severity,
      description: row.description,
      coordinates: {
        latitude: Number.parseFloat(row.latitude),
        longitude: Number.parseFloat(row.longitude),
      },
      distanceMeters: Number.parseFloat(row.distance_meters),
      affectedRadiusKm: Number.parseFloat(row.affected_radius_km),
      startTime: row.start_time,
      estimatedEndTime: row.estimated_end_time,
      riskFactor: INCIDENT_SEVERITY_PENALTY[row.severity] ?? 0,
    }));
  }

  /** Incidentes activos dentro de un rectángulo, para pintarlos en el mapa. */
  async findInBoundingBox(bbox: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  }): Promise<RoadIncident[]> {
    return this.repository
      .createQueryBuilder('incident')
      .where('incident.is_active = true')
      .andWhere('(incident.estimated_end_time IS NULL OR incident.estimated_end_time >= NOW())')
      .andWhere(
        'ST_Intersects(incident.incident_location, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))',
        bbox,
      )
      .orderBy('incident.severity', 'DESC')
      .limit(500)
      .getMany();
  }

  async create(
    dto: CreateIncidentDto,
    actor: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<RoadIncident> {
    const incident = this.repository.create({
      incidentLocation: toGeoJSONPoint({ latitude: dto.latitude, longitude: dto.longitude }),
      incidentType: dto.incidentType,
      severity: dto.severity,
      description: dto.description,
      startTime: dto.startTime ? new Date(dto.startTime) : new Date(),
      estimatedEndTime: dto.estimatedEndTime ? new Date(dto.estimatedEndTime) : null,
      affectedRadiusKm: dto.affectedRadiusKm ?? 2,
      source: 'manual',
    });

    const saved = await this.repository.save(incident);

    await this.auditService.record({
      action: AuditAction.Create,
      entityType: 'road_incident',
      entityId: saved.id,
      userId: actor.id,
      userEmail: actor.email,
      newValues: { ...dto },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return saved;
  }

  async update(
    id: string,
    dto: UpdateIncidentDto,
    actor: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<RoadIncident> {
    const incident = await this.repository.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incidente no encontrado.');

    const oldValues = {
      severity: incident.severity,
      isActive: incident.isActive,
      description: incident.description,
    };

    if (dto.severity !== undefined) incident.severity = dto.severity;
    if (dto.description !== undefined) incident.description = dto.description;
    if (dto.isActive !== undefined) incident.isActive = dto.isActive;
    if (dto.estimatedEndTime !== undefined) {
      incident.estimatedEndTime = dto.estimatedEndTime ? new Date(dto.estimatedEndTime) : null;
    }
    if (dto.affectedRadiusKm !== undefined) incident.affectedRadiusKm = dto.affectedRadiusKm;

    const saved = await this.repository.save(incident);

    await this.auditService.record({
      action: AuditAction.Update,
      entityType: 'road_incident',
      entityId: saved.id,
      userId: actor.id,
      userEmail: actor.email,
      oldValues,
      newValues: { ...dto },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return saved;
  }

  async findOne(id: string): Promise<RoadIncident> {
    const incident = await this.repository.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incidente no encontrado.');
    return incident;
  }
}
