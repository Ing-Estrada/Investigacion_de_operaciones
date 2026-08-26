import { ApiProperty } from '@nestjs/swagger';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { IncidentSeverity, IncidentType } from '@/common/enums';
import { decimal2 } from '@/common/transformers/decimal.transformer';
import { GeoJSONPoint } from '@/common/types/geo.types';

/** Incidente vial: accidente, obra, restricción o congestión (RF-008). */
@Entity('road_incidents')
@Check('chk_incidents_radius', 'affected_radius_km > 0')
@Check(
  'chk_incidents_time_window',
  'estimated_end_time IS NULL OR estimated_end_time >= start_time',
)
export class RoadIncident {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_road_incidents_location', { spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    name: 'incident_location',
  })
  incidentLocation: GeoJSONPoint;

  @ApiProperty({ enum: IncidentType })
  @Column({ type: 'enum', enum: IncidentType, name: 'incident_type' })
  incidentType: IncidentType;

  @ApiProperty()
  @Column({ type: 'text' })
  description: string;

  @ApiProperty({ enum: IncidentSeverity })
  @Column({ type: 'enum', enum: IncidentSeverity })
  severity: IncidentSeverity;

  @ApiProperty()
  @Index('idx_road_incidents_active')
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty()
  @Column({ type: 'timestamptz', name: 'start_time' })
  startTime: Date;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamptz', name: 'estimated_end_time', nullable: true })
  estimatedEndTime: Date | null;

  @ApiProperty({ example: 2.0, description: 'Radio de afectación en km' })
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    name: 'affected_radius_km',
    default: 2.0,
    transformer: decimal2,
  })
  affectedRadiusKm: number;

  /** Origen del dato: `manual`, o el identificador del proveedor que lo reportó. */
  @ApiProperty({ example: 'manual' })
  @Column({ type: 'varchar', length: 50, default: 'manual' })
  source: string;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
