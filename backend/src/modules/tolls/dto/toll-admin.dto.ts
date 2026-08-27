import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsISO4217CurrencyCode,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { TollCategory } from '@/common/enums';

export class CreateTollStationDto {
  @ApiProperty({ example: 'Peaje Los Cauchos' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 2.0589 })
  @Type(() => Number)
  @IsLatitude({ message: 'La latitud debe estar entre -90 y 90.' })
  latitude: number;

  @ApiProperty({ example: -75.8392 })
  @Type(() => Number)
  @IsLongitude({ message: 'La longitud debe estar entre -180 y 180.' })
  longitude: number;

  @ApiProperty({ example: 'Ruta 45 - Pitalito/Garzón' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  highwayName: string;

  @ApiPropertyOptional({ example: 'INVÍAS' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  operator?: string | null;
}

export class UpdateTollStationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  highwayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  operator?: string | null;

  /**
   * Desactivar una estación la excluye del cálculo sin borrarla. Se prefiere a un DELETE
   * porque las tarifas históricas cuelgan de ella en cascada: borrarla destruiría la
   * justificación de los costes ya calculados.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTollRateDto {
  @ApiProperty({ enum: TollCategory })
  @IsEnum(TollCategory)
  vehicleCategory: TollCategory;

  @ApiProperty({ example: 14.8, minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  rateAmount: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsISO4217CurrencyCode({ message: 'La moneda debe ser un código ISO 4217 de tres letras.' })
  currency?: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString({ strict: false }, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  effectiveDate: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Null si sigue vigente.' })
  @IsOptional()
  @IsDateString({ strict: false })
  expirationDate?: string | null;
}

/** La categoría y la fecha de vigencia identifican la tarifa y no se pueden reescribir. */
export class UpdateTollRateDto {
  @ApiPropertyOptional({ example: 15.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  rateAmount?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString({ strict: false })
  expirationDate?: string | null;
}
