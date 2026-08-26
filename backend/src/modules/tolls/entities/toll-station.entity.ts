import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { GeoJSONPoint } from '@/common/types/geo.types';

import { TollRate } from './toll-rate.entity';

@Entity('toll_stations')
export class TollStation {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Peaje Los Cauchos' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Índice GIST: sin él, `ST_DWithin` degenera en un scan secuencial de toda la tabla. */
  @Index('idx_toll_stations_location', { spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: GeoJSONPoint;

  @ApiProperty({ example: 'Ruta 45' })
  @Column({ type: 'varchar', length: 100, name: 'highway_name' })
  highwayName: string;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  @ApiProperty()
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => TollRate, (rate) => rate.tollStation)
  rates: TollRate[];
}
