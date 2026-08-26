import { ApiProperty } from '@nestjs/swagger';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { TollCategory } from '@/common/enums';
import { decimal2 } from '@/common/transformers/decimal.transformer';

import { TollStation } from './toll-station.entity';

/**
 * Tarifa vigente de una estación para una categoría tarifaria (RF-009, RF-015).
 *
 * La tarifa se indexa por `TollCategory` y no por tipo de vehículo: los operadores
 * publican precios por categoría, y varios tipos de vehículo comparten categoría.
 * Modelarlo por tipo obligaría a duplicar cada tarifa N veces y a mantenerlas en sync.
 */
@Entity('toll_rates')
@Unique('uq_toll_rates_station_category_date', [
  'tollStationId',
  'vehicleCategory',
  'effectiveDate',
])
@Check('chk_toll_rates_amount', 'rate_amount > 0')
@Check('chk_toll_rates_dates', 'expiration_date IS NULL OR expiration_date >= effective_date')
export class TollRate {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_toll_rates_station_id')
  @Column({ type: 'uuid', name: 'toll_station_id' })
  tollStationId: string;

  @ManyToOne(() => TollStation, (station) => station.rates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toll_station_id' })
  tollStation: TollStation;

  @ApiProperty({ enum: TollCategory })
  @Column({ type: 'enum', enum: TollCategory, name: 'vehicle_category' })
  vehicleCategory: TollCategory;

  @ApiProperty({ example: 4.5 })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'rate_amount', transformer: decimal2 })
  rateAmount: number;

  @ApiProperty({ example: 'USD' })
  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @ApiProperty({ type: String, format: 'date' })
  @Index('idx_toll_rates_effective_date')
  @Column({ type: 'date', name: 'effective_date' })
  effectiveDate: string;

  @ApiProperty({ type: String, format: 'date', required: false, nullable: true })
  @Column({ type: 'date', name: 'expiration_date', nullable: true })
  expirationDate: string | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
