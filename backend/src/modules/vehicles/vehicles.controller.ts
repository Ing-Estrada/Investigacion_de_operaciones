import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { VehicleType } from './entities/vehicle-type.entity';
import { Vehicle } from './entities/vehicle.entity';
import { VehiclesService } from './vehicles.service';

@ApiTags('Vehicles')
@ApiBearerAuth('JWT')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get('types')
  @ApiOperation({
    summary: 'Catálogo de tipos de vehículo',
    description: 'Incluye perfil de consumo, límites físicos y categoría de peaje (RF-012).',
  })
  @ApiResponse({ status: 200, type: [VehicleType] })
  async findTypes(): Promise<VehicleType[]> {
    return this.vehiclesService.findAllTypes();
  }

  @Get()
  @ApiOperation({ summary: 'Vehículos accesibles para el usuario autenticado' })
  @ApiResponse({ status: 200, type: [Vehicle] })
  async findAll(@CurrentUser() user: AuthenticatedUser): Promise<Vehicle[]> {
    return this.vehiclesService.findAllForUser(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un vehículo' })
  @ApiResponse({ status: 200, type: Vehicle })
  @ApiResponse({ status: 404, description: 'No existe o no es accesible para este usuario' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Vehicle> {
    return this.vehiclesService.findOneForUser(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Da de alta un vehículo' })
  @ApiResponse({ status: 201, type: Vehicle })
  @ApiResponse({ status: 409, description: 'La placa ya está registrada' })
  async create(
    @Body() dto: CreateVehicleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<Vehicle> {
    return this.vehiclesService.create(dto, user, request);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza combustible, consumo medido o estado' })
  @ApiResponse({ status: 200, type: Vehicle })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<Vehicle> {
    return this.vehiclesService.update(id, dto, user, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Da de baja un vehículo',
    description: 'Baja lógica: las rutas históricas conservan la referencia.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<void> {
    return this.vehiclesService.deactivate(id, user, request);
  }
}
