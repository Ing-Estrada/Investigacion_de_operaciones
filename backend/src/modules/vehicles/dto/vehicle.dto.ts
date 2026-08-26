import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Placa alfanumérica con guiones opcionales; se normaliza a mayúsculas sin espacios. */
const PLATE_PATTERN = /^[A-Z0-9-]{4,20}$/;

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABC-123' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : value,
  )
  @IsString()
  @Matches(PLATE_PATTERN, {
    message: 'La placa debe tener entre 4 y 20 caracteres alfanuméricos o guiones.',
  })
  plate: string;

  @ApiProperty({ format: 'uuid', description: 'Id del tipo de vehículo del catálogo' })
  @IsUUID('4')
  vehicleTypeId: string;

  @ApiProperty({ example: 'Kenworth' })
  @IsString()
  @MaxLength(100)
  manufacturer: string;

  @ApiProperty({ example: 'T680' })
  @IsString()
  @MaxLength(100)
  model: string;

  @ApiProperty({ example: 2024 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @ApiProperty({ example: 400, description: 'Capacidad del depósito en litros' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(9999)
  fuelCapacityLiters: number;

  @ApiPropertyOptional({ example: 180, description: 'Combustible actual en litros' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999)
  currentFuelLiters?: number;

  @ApiPropertyOptional({
    example: 31.2,
    description: 'Consumo medido en L/100 km. Si se omite se usa el del tipo de vehículo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(200)
  customFuelConsumptionLPer100Km?: number;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999)
  currentFuelLiters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(200)
  customFuelConsumptionLPer100Km?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
