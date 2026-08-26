import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { IncidentSeverity, RoadType } from '@/common/enums';
import { decimal2 } from '@/common/transformers/decimal.transformer';
import { GeoJSONPoint } from '@/common/types/geo.types';

import { Route } from './route.entity';

/**
 * Tramo homogéneo de una ruta: mismo tipo de vía, mismas condiciones. Es la unidad
 * sobre la que se enriquecen clima, incidentes y peajes (RF-007, RF-008, RF-009).
 */
@Entity('route_segments')
@Unique('uq_route_segments_order', ['routeId', 'segmentOrder'])
export class RouteSegment {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_route_segments_route_id')
  @Column({ type: 'uuid', name: 'route_id' })
  routeId: string;

  @ManyToOne(() => Route, (route) => route.segments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route: Route;

  @ApiProperty({ example: 0 })
  @Column({ type: 'smallint', name: 'segment_order' })
  segmentOrder: number;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, name: 'start_point' })
  startPoint: GeoJSONPoint;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, name: 'end_point' })
  endPoint: GeoJSONPoint;

  @ApiProperty({ example: 12.4 })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'segment_distance_km',
    transformer: decimal2,
  })
  segmentDistanceKm: number;

  @ApiProperty({ example: 9.6 })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    name: 'segment_duration_minutes',
    transformer: decimal2,
  })
  segmentDurationMinutes: number;

  @ApiProperty({ enum: RoadType })
  @Column({ type: 'enum', enum: RoadType, name: 'road_type' })
  roadType: RoadType;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 150, name: 'road_name', nullable: true })
  roadName: string | null;

  // --- Peajes ---------------------------------------------------------------
  @ApiProperty()
  @Column({ type: 'boolean', name: 'has_toll', default: false })
  hasToll: boolean;

  @ApiProperty({ required: false, nullable: true })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'toll_cost',
    nullable: true,
    transformer: decimal2,
  })
  tollCost: number | null;

  @Column({ type: 'uuid', name: 'toll_station_id', nullable: true })
  tollStationId: string | null;

  // --- Clima ----------------------------------------------------------------
  @ApiProperty({ required: false, nullable: true, example: 'lluvia moderada' })
  @Column({ type: 'varchar', length: 80, name: 'weather_condition', nullable: true })
  weatherCondition: string | null;

  /** Sobrecoste de consumo/tiempo por meteorología, en el rango 0-1. */
  @ApiProperty({ example: 0.3 })
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 3,
    name: 'weather_intensity_factor',
    default: 0,
    transformer: decimal3,
  })
  weatherIntensityFactor: number;

  // --- Incidentes -----------------------------------------------------------
  @ApiProperty()
  @Column({ type: 'boolean', name: 'incident_present', default: false })
  incidentPresent: boolean;

  @ApiProperty({ enum: IncidentSeverity, required: false, nullable: true })
  @Column({
    type: 'enum',
    enum: IncidentSeverity,
    name: 'incident_severity',
    nullable: true,
  })
  incidentSeverity: IncidentSeverity | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
