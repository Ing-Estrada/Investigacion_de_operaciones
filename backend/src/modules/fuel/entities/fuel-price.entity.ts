import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { FuelType } from '@/common/enums';
import { decimal4 } from '@/common/transformers/decimal.transformer';

/**
 * Precio del combustible por litro, versionado en el tiempo.
 *
 * Se versiona con `effective_date`/`expiration_date` en lugar de mantener un único valor
 * mutable, por el mismo motivo que las tarifas de peaje: el precio cambia a menudo y una
 * ruta calculada hace un mes tiene que poder justificarse con el precio de entonces.
 * Sobrescribir el valor haría imposible auditar un coste pasado.
 */
@Entity('fuel_prices')
export class FuelPrice {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: FuelType })
  @Index('idx_fuel_prices_lookup')
  @Column({ type: 'enum', enum: FuelType, enumName: 'fuel_type_enum', name: 'fuel_type' })
  fuelType: FuelType;

  @ApiProperty({ example: 1.05 })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    name: 'price_per_liter',
    transformer: decimal4,
  })
  pricePerLiter: number;

  @ApiProperty({ example: 'USD' })
  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @ApiProperty({ example: '2026-01-01' })
  @Column({ type: 'date', name: 'effective_date' })
  effectiveDate: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'date', name: 'expiration_date', nullable: true })
  expirationDate: string | null;

  /** De dónde sale el dato: resolución oficial, boletín, captura manual. */
  @ApiPropertyOptional({ nullable: true, example: 'Resolución MME 40123 de 2026' })
  @Column({ type: 'varchar', length: 120, nullable: true })
  source: string | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
