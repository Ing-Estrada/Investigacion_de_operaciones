import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TollCategory } from '@/common/enums';
import { Coordinates } from '@/common/types/geo.types';
import { toLineStringWkt } from '@/common/utils/wkt';

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

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
          AND ($4::text IS NULL OR tr.vehicle_category = $4::toll_rates_vehicle_category_enum)
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
}
