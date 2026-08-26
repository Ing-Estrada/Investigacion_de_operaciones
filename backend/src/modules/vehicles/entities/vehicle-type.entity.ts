import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { TollCategory, WeightCategory } from '@/common/enums';
import { decimal2 } from '@/common/transformers/decimal.transformer';

import { Vehicle } from './vehicle.entity';

/**
 * Catálogo de tipos de vehículo (RF-012). Define tanto el perfil de consumo (RF-013)
 * como los límites físicos que determinan si una vía es transitable (RF-014) y la
 * categoría tarifaria de peaje (RF-015).
 */
@Entity('vehicle_types')
export class VehicleType {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Camión rígido 2 ejes' })
  @Column({ type: 'varchar', length: 50, unique: true })
  name: string;

  @ApiProperty({ enum: WeightCategory })
  @Column({ type: 'enum', enum: WeightCategory, name: 'weight_category' })
  weightCategory: WeightCategory;

  @ApiProperty({ example: 2 })
  @Column({ type: 'smallint', name: 'axles' })
  axles: number;

  @ApiProperty({ example: 12000, description: 'Peso bruto vehicular máximo en kg' })
  @Column({ type: 'integer', name: 'max_weight_kg' })
  maxWeightKg: number;

  @ApiProperty({ example: 4.1 })
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    name: 'max_height_meters',
    transformer: decimal2,
  })
  maxHeightMeters: number;

  @ApiProperty({ example: 2.6 })
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    name: 'max_width_meters',
    transformer: decimal2,
  })
  maxWidthMeters: number;

  @ApiProperty({ example: 28.5, description: 'Consumo base en litros por 100 km' })
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'avg_fuel_consumption_l_per_100km',
    transformer: decimal2,
  })
  avgFuelConsumptionLPer100Km: number;

  @ApiProperty({ enum: TollCategory })
  @Column({ type: 'enum', enum: TollCategory, name: 'toll_category' })
  tollCategory: TollCategory;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.vehicleType)
  vehicles: Vehicle[];
}
