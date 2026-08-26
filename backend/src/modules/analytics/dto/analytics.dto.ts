import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { RouteStatus } from '@/common/enums';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Un año es el techo: series más largas deben resolverse con tablas de agregados
  // precalculados, no escaneando el histórico completo en cada petición.
  @Max(365)
  days?: number;
}

export class RouteAnalyticsDto {
  @ApiProperty() periodDays: number;
  @ApiProperty() totalRoutes: number;
  @ApiProperty() totalDistanceKm: number;
  @ApiProperty() totalFuelLiters: number;
  @ApiProperty() totalCost: number;
  @ApiProperty() totalTollCost: number;
  @ApiProperty({ description: 'Puntuación multicriterio media, 0-100' })
  averageScore: number;
  @ApiProperty() averageDurationMinutes: number;
  @ApiProperty({ description: 'Tiempo medio de cálculo en ms (RNF-008)' })
  averageComputationTimeMs: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  routesByStatus: Record<RouteStatus, number>;
}

export class RoutesOverTimeDto {
  @ApiProperty({ example: '2026-08-26' }) day: string;
  @ApiProperty() routes: number;
  @ApiProperty() distanceKm: number;
  @ApiProperty() totalCost: number;
}

export class CostByRoadTypeDto {
  @ApiProperty({ example: 'highway' }) roadType: string;
  @ApiProperty() distanceKm: number;
  @ApiProperty() tollCost: number;
  @ApiProperty() segments: number;
}
