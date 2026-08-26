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
  UpdateDateColumn,
} from 'typeorm';

import { decimal2 } from '@/common/transformers/decimal.transformer';
import { User } from '@/modules/auth/entities/user.entity';

import { VehicleType } from './vehicle-type.entity';

@Entity('vehicles')
@Check('chk_vehicles_year', 'year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1')
@Check(
  'chk_vehicles_fuel_level',
  'current_fuel_liters >= 0 AND current_fuel_liters <= fuel_capacity_liters',
)
export class Vehicle {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_vehicles_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('idx_vehicles_vehicle_type_id')
  @Column({ type: 'uuid', name: 'vehicle_type_id' })
  vehicleTypeId: string;

  /**
   * RESTRICT y no CASCADE: borrar un tipo de vehículo del catálogo no puede llevarse
   * por delante la flota que lo usa.
   */
  @ManyToOne(() => VehicleType, (type) => type.vehicles, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'vehicle_type_id' })
  vehicleType: VehicleType;

  @ApiProperty({ example: 'ABC-123' })
  @Column({ type: 'varchar', length: 20, unique: true })
  plate: string;

  @ApiProperty({ example: 'Kenworth' })
  @Column({ type: 'varchar', length: 100 })
  manufacturer: string;

  @ApiProperty({ example: 'T680' })
  @Column({ type: 'varchar', length: 100 })
  model: string;

  @ApiProperty({ example: 2024 })
  @Column({ type: 'smallint' })
  year: number;

  @ApiProperty({ example: 180.5 })
  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    name: 'current_fuel_liters',
    default: 0,
    transformer: decimal2,
  })
  currentFuelLiters: number;

  @ApiProperty({ example: 400 })
  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    name: 'fuel_capacity_liters',
    transformer: decimal2,
  })
  fuelCapacityLiters: number;

  /**
   * Consumo medido de este vehículo concreto. Si es null se usa el del tipo: un camión
   * con 800 000 km no consume lo que dice la ficha técnica.
   */
  @ApiProperty({ required: false, nullable: true })
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'custom_fuel_consumption_l_per_100km',
    nullable: true,
    transformer: decimal2,
  })
  customFuelConsumptionLPer100Km: number | null;

  @ApiProperty()
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  /** Consumo efectivo: el medido si existe, el del catálogo si no. */
  get effectiveConsumptionLPer100Km(): number {
    return this.customFuelConsumptionLPer100Km ?? this.vehicleType.avgFuelConsumptionLPer100Km;
  }
}
