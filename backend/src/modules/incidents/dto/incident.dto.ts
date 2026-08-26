import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
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

import { IncidentSeverity, IncidentType } from '@/common/enums';

export class CreateIncidentDto {
  @ApiProperty({ example: 2.9273, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsLatitude({ message: 'La latitud debe estar entre -90 y 90.' })
  latitude: number;

  @ApiProperty({ example: -75.2819, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsLongitude({ message: 'La longitud debe estar entre -180 y 180.' })
  longitude: number;

  @ApiProperty({ enum: IncidentType })
  @IsEnum(IncidentType)
  incidentType: IncidentType;

  @ApiProperty({ enum: IncidentSeverity })
  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @ApiProperty({ example: 'Derrumbe en el km 42, un carril cerrado.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Por defecto, ahora.' })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Null si se desconoce.' })
  @IsOptional()
  @IsDateString()
  estimatedEndTime?: string;

  @ApiPropertyOptional({ example: 2, minimum: 0.1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  affectedRadiusKm?: number;
}

export class UpdateIncidentDto {
  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  estimatedEndTime?: string | null;

  @ApiPropertyOptional({ minimum: 0.1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  affectedRadiusKm?: number;
}

export class BoundingBoxQueryDto {
  @ApiProperty({ example: 2.5 })
  @Type(() => Number)
  @IsLatitude()
  minLat: number;

  @ApiProperty({ example: -76.0 })
  @Type(() => Number)
  @IsLongitude()
  minLon: number;

  @ApiProperty({ example: 3.5 })
  @Type(() => Number)
  @IsLatitude()
  maxLat: number;

  @ApiProperty({ example: -75.0 })
  @Type(() => Number)
  @IsLongitude()
  maxLon: number;
}
