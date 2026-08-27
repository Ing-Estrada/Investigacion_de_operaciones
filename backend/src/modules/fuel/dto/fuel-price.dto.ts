import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FuelType } from '@/common/enums';

export class CreateFuelPriceDto {
  @ApiProperty({ enum: FuelType })
  @IsEnum(FuelType)
  fuelType: FuelType;

  /**
   * El techo de 100 000 no es cosmético: en monedas de baja denominación un litro puede
   * costar miles de unidades, así que acotarlo a dos cifras rechazaría precios legítimos.
   * El suelo excluye el 0, que haría gratis el combustible y falsearía la optimización.
   */
  @ApiProperty({ example: 1.05, minimum: 0.0001, maximum: 100_000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100_000)
  pricePerLiter: number;

  @ApiPropertyOptional({ example: 'USD', description: 'Por defecto, la del entorno.' })
  @IsOptional()
  @IsISO4217CurrencyCode({ message: 'La moneda debe ser un código ISO 4217 de tres letras.' })
  currency?: string;

  @ApiProperty({ example: '2026-01-01', description: 'Fecha de entrada en vigor (YYYY-MM-DD).' })
  @IsDateString({ strict: false }, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  effectiveDate: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Null si sigue vigente.' })
  @IsOptional()
  @IsDateString({ strict: false })
  expirationDate?: string | null;

  @ApiPropertyOptional({ example: 'Resolución MME 40123 de 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string | null;
}

/**
 * `fuelType` y `effectiveDate` no se pueden cambiar: identifican la fila y alterarlos
 * reescribiría la historia de precios. Para corregirlos se cierra este precio y se crea
 * otro.
 */
export class UpdateFuelPriceDto {
  @ApiPropertyOptional({ example: 1.12 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100_000)
  pricePerLiter?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString({ strict: false })
  expirationDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string | null;
}
