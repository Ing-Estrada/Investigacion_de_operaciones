import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RateLimit, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

import {
  OptimizeRouteDto,
  OptimizedRouteResponseDto,
  RouteListQueryDto,
  RouteResponseDto,
  UpdateRouteStatusDto,
} from './dto/route.dto';
import { RoutesService } from './routes.service';

@ApiTags('Routes')
@ApiBearerAuth('JWT')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post('optimize')
  @HttpCode(HttpStatus.CREATED)
  // 50 cálculos por hora y usuario: cada uno consume cuota de los proveedores externos
  // (red vial, clima) y CPU en la optimización.
  @RateLimit({ limit: 50, windowSec: 3600 })
  @Roles(Role.Admin, Role.Dispatcher, Role.Customer)
  @ApiOperation({
    summary: 'Calcula la ruta óptima y sus alternativas',
    description:
      'Optimización multicriterio sobre la red vial real: 40% distancia, 30% tiempo, ' +
      '20% coste y 10% riesgo. Incorpora clima, incidentes activos y peajes por ' +
      'categoría de vehículo antes de decidir el camino.',
  })
  @ApiResponse({ status: 201, type: OptimizedRouteResponseDto })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 422, description: 'Sin ruta transitable o vehículo no apto' })
  @ApiResponse({ status: 502, description: 'Proveedor externo no disponible' })
  async optimize(
    @Body() dto: OptimizeRouteDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<OptimizedRouteResponseDto> {
    return this.routesService.optimize(dto, user, request);
  }

  @Get()
  @ApiOperation({
    summary: 'Historial de rutas',
    description:
      'Devuelve solo rutas principales; las alternativas van anidadas en el detalle. ' +
      'ADMIN y DISPATCHER ven todas, el resto solo las suyas.',
  })
  async findAll(
    @Query() query: RouteListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: RouteResponseDto[]; total: number; page: number; limit: number }> {
    return this.routesService.findAllForUser(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una ruta con sus alternativas' })
  @ApiResponse({ status: 200, type: OptimizedRouteResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OptimizedRouteResponseDto> {
    return this.routesService.findOneForUser(id, user);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Actualiza el estado de una ruta',
    description: 'Un conductor marca así una ruta como iniciada o completada.',
  })
  @ApiResponse({ status: 200, type: RouteResponseDto })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouteStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<RouteResponseDto> {
    return this.routesService.updateStatus(id, dto.status, user, request);
  }
}
