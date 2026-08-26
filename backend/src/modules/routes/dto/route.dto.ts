import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { IncidentSeverity, IncidentType, RoadType, RouteStatus } from '@/common/enums';

export class LocationDto {
  @ApiProperty({ example: 1.8536, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsLatitude({ message: 'La latitud debe estar entre -90 y 90.' })
  latitude: number;

  @ApiProperty({ example: -76.0511, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsLongitude({ message: 'La longitud debe estar entre -180 y 180.' })
  longitude: number;

  @ApiPropertyOptional({ example: 'Pitalito, Huila' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  address?: string;
}

export class OptimizeRouteDto {
  @ApiProperty({ type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  origin: LocationDto;

  @ApiProperty({ type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  destination: LocationDto;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  vehicleId: string;

  @ApiPropertyOptional({
    default: 2,
    minimum: 0,
    maximum: 4,
    description: 'Rutas alternativas a calcular además de la óptima (RF-004).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Tope en 4: Yen cuesta O(K·V·E log V) y pasar de aquí compromete el objetivo de
  // 2 segundos de RNF-008 sin aportar alternativas realmente distintas.
  @Max(4)
  alternatives?: number;

  @ApiPropertyOptional({ enum: ['astar', 'dijkstra'], default: 'astar' })
  @IsOptional()
  @IsIn(['astar', 'dijkstra'])
  algorithm?: 'astar' | 'dijkstra';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  avoidTolls?: boolean;
}

// --- Respuestas -------------------------------------------------------------

export class RouteSegmentDto {
  @ApiProperty() order: number;
  @ApiProperty() distanceKm: number;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ enum: RoadType }) roadType: RoadType;
  @ApiProperty({ nullable: true }) roadName: string | null;
  @ApiProperty() hasToll: boolean;
  @ApiProperty({ nullable: true }) tollCost: number | null;
  @ApiProperty({ nullable: true }) weatherCondition: string | null;
  @ApiProperty() weatherIntensityFactor: number;
  @ApiProperty() incidentPresent: boolean;
  @ApiProperty({ enum: IncidentSeverity, nullable: true })
  incidentSeverity: IncidentSeverity | null;
  @ApiProperty({ type: 'array', items: { type: 'array', items: { type: 'number' } } })
  geometry: [number, number][];
}

export class CostBreakdownDto {
  @ApiProperty({ example: 42.31 }) fuelLiters: number;
  @ApiProperty({ example: 44.43 }) fuelCost: number;
  @ApiProperty({ example: 8.5 }) tollCost: number;
  @ApiProperty({ example: 52.93 }) totalCost: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: 1.05 }) fuelPricePerLiter: number;
}

export class ScoreDto {
  @ApiProperty() distanceScore: number;
  @ApiProperty() timeScore: number;
  @ApiProperty() costScore: number;
  @ApiProperty() safetyScore: number;
  @ApiProperty({ description: 'Media ponderada 0-100' }) total: number;
}

export class TollBreakdownItemDto {
  @ApiProperty() stationId: string;
  @ApiProperty() name: string;
  @ApiProperty() highwayName: string;
  @ApiProperty({ nullable: true }) amount: number | null;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
}

export class IncidentSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: IncidentType }) incidentType: IncidentType;
  @ApiProperty({ enum: IncidentSeverity }) severity: IncidentSeverity;
  @ApiProperty() description: string;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
}

export class WeatherSummaryDto {
  @ApiProperty({ description: 'Peor factor de intensidad de la ruta, 0-1' })
  worstIntensity: number;

  @ApiProperty() averageIntensity: number;

  @ApiProperty({ type: [String] }) conditions: string[];

  @ApiProperty({ description: 'true si hay alerta meteorológica relevante' })
  alert: boolean;

  @ApiProperty({ description: 'true si no se pudieron obtener datos reales' })
  degraded: boolean;
}

export class RouteResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true }) parentRouteId: string | null;
  @ApiProperty({ nullable: true }) alternativeRank: number | null;

  @ApiProperty() distanceKm: number;
  @ApiProperty() durationMinutes: number;

  @ApiProperty({ type: CostBreakdownDto }) cost: CostBreakdownDto;
  @ApiProperty({ type: ScoreDto }) score: ScoreDto;

  @ApiProperty({ type: LocationDto }) origin: LocationDto;
  @ApiProperty({ type: LocationDto }) destination: LocationDto;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
    description: 'Traza completa como [latitud, longitud][]',
  })
  geometry: [number, number][];

  @ApiProperty({ type: [RouteSegmentDto] }) segments: RouteSegmentDto[];
  @ApiProperty({ type: [TollBreakdownItemDto] }) tollBreakdown: TollBreakdownItemDto[];
  @ApiProperty({ type: [IncidentSummaryDto] }) incidents: IncidentSummaryDto[];
  @ApiProperty({ type: WeatherSummaryDto }) weather: WeatherSummaryDto;

  @ApiProperty({ enum: RouteStatus }) status: RouteStatus;
  @ApiProperty({ example: 'astar' }) algorithm: string;
  @ApiProperty() computationTimeMs: number;
  @ApiProperty() createdAt: Date;
}

export class OptimizedRouteResponseDto {
  @ApiProperty({ type: RouteResponseDto, description: 'Ruta óptima' })
  route: RouteResponseDto;

  @ApiProperty({ type: [RouteResponseDto], description: 'Alternativas ordenadas por score' })
  alternatives: RouteResponseDto[];
}

export class RouteListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: RouteStatus })
  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;
}

export class UpdateRouteStatusDto {
  @ApiProperty({ enum: RouteStatus })
  @IsEnum(RouteStatus)
  status: RouteStatus;
}
