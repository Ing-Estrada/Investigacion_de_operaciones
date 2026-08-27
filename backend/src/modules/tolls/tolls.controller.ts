import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { CurrentUser, Roles } from '@/common/decorators';
import { Role, TollCategory } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

import {
  CreateTollRateDto,
  CreateTollStationDto,
  UpdateTollRateDto,
  UpdateTollStationDto,
} from './dto/toll-admin.dto';
import { TollRate } from './entities/toll-rate.entity';
import { TollStation } from './entities/toll-station.entity';
import { TollHit, TollsService } from './tolls.service';

export class NearbyTollsQueryDto {
  @ApiProperty({ example: 2.9273 })
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -75.2819 })
  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ example: 25000, description: 'Radio en metros (máx. 100 km)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(100_000)
  radiusMeters?: number;

  @ApiPropertyOptional({ enum: TollCategory })
  @IsOptional()
  @IsEnum(TollCategory)
  category?: TollCategory;
}

export class ListStationsQueryDto {
  @ApiPropertyOptional({ description: 'Incluye las estaciones dadas de baja.' })
  @IsOptional()
  // El query string trae "true"/"false" como texto; sin esta conversión @IsBoolean falla.
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

@ApiTags('Tolls')
@ApiBearerAuth('JWT')
@Controller('tolls')
export class TollsController {
  constructor(private readonly tollsService: TollsService) {}

  @Get('stations')
  @ApiOperation({
    summary: 'Estaciones de peaje cercanas a un punto',
    description: 'Devuelve la tarifa vigente para la categoría indicada, si existe (RF-009).',
  })
  async findNearby(@Query() query: NearbyTollsQueryDto): Promise<TollHit[]> {
    return this.tollsService.findNearby(
      { latitude: query.latitude, longitude: query.longitude },
      query.radiusMeters ?? 25_000,
      query.category,
    );
  }

  @Get('admin/stations')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({
    summary: 'Catálogo completo de estaciones con sus tarifas',
    description: 'Alimenta la pantalla de tarifas. Incluye las inactivas si se pide.',
  })
  async listStations(@Query() query: ListStationsQueryDto): Promise<TollStation[]> {
    return this.tollsService.listStations(query.includeInactive ?? false);
  }

  @Post('admin/stations')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({ summary: 'Da de alta una estación de peaje' })
  async createStation(
    @Body() dto: CreateTollStationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<TollStation> {
    return this.tollsService.createStation(dto, user, request);
  }

  @Patch('admin/stations/:id')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({
    summary: 'Actualiza una estación',
    description: '`isActive: false` la excluye del cálculo sin destruir su histórico.',
  })
  async updateStation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTollStationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<TollStation> {
    return this.tollsService.updateStation(id, dto, user, request);
  }

  @Post('admin/stations/:id/rates')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({ summary: 'Añade una tarifa por categoría a una estación' })
  async createRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTollRateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<TollRate> {
    return this.tollsService.createRate(id, dto, user, request);
  }

  @Patch('admin/rates/:rateId')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({
    summary: 'Corrige el importe o la caducidad de una tarifa',
    description: 'La categoría y la vigencia identifican la fila y no se pueden reescribir.',
  })
  async updateRate(
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @Body() dto: UpdateTollRateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<TollRate> {
    return this.tollsService.updateRate(rateId, dto, user, request);
  }
}
