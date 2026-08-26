import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators';
import { AuthenticatedUser } from '@/common/types/authenticated-user';

import { AnalyticsService } from './analytics.service';
import {
  AnalyticsQueryDto,
  CostByRoadTypeDto,
  RouteAnalyticsDto,
  RoutesOverTimeDto,
} from './dto/analytics.dto';

const DEFAULT_PERIOD_DAYS = 30;

@ApiTags('Analytics')
@ApiBearerAuth('JWT')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Indicadores agregados del periodo',
    description: 'ADMIN y DISPATCHER ven la operación completa; el resto, solo sus propias rutas.',
  })
  @ApiResponse({ status: 200, type: RouteAnalyticsDto })
  async summary(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RouteAnalyticsDto> {
    return this.analyticsService.summary(user, query.days ?? DEFAULT_PERIOD_DAYS);
  }

  @Get('over-time')
  @ApiOperation({ summary: 'Serie diaria de rutas, distancia y coste' })
  @ApiResponse({ status: 200, type: [RoutesOverTimeDto] })
  async overTime(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoutesOverTimeDto[]> {
    return this.analyticsService.overTime(user, query.days ?? DEFAULT_PERIOD_DAYS);
  }

  @Get('by-road-type')
  @ApiOperation({ summary: 'Distancia y peajes por tipo de vía' })
  @ApiResponse({ status: 200, type: [CostByRoadTypeDto] })
  async byRoadType(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CostByRoadTypeDto[]> {
    return this.analyticsService.costByRoadType(user, query.days ?? DEFAULT_PERIOD_DAYS);
  }
}
