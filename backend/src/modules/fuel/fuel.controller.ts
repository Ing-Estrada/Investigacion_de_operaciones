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
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { CurrentUser, Roles } from '@/common/decorators';
import { FuelType, Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

import { CreateFuelPriceDto, UpdateFuelPriceDto } from './dto/fuel-price.dto';
import { FuelPrice } from './entities/fuel-price.entity';
import { FuelService, ResolvedFuelPrice } from './fuel.service';

export class FuelPricesQueryDto {
  @ApiPropertyOptional({ enum: FuelType })
  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;
}

@ApiTags('Fuel')
@ApiBearerAuth('JWT')
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get('prices/current')
  @ApiOperation({
    summary: 'Precio vigente de cada combustible',
    description:
      'Si un combustible no tiene precio cargado se devuelve el del entorno, marcado ' +
      'con `origin: "configured"` para que la interfaz pueda advertirlo.',
  })
  async current(): Promise<ResolvedFuelPrice[]> {
    return this.fuelService.currentPrices();
  }

  @Get('prices')
  @ApiOperation({ summary: 'Histórico de precios, del más reciente al más antiguo' })
  async findAll(@Query() query: FuelPricesQueryDto): Promise<FuelPrice[]> {
    return this.fuelService.findAll(query.fuelType);
  }

  @Post('prices')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({ summary: 'Registra un precio de combustible' })
  async create(
    @Body() dto: CreateFuelPriceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<FuelPrice> {
    return this.fuelService.create(dto, user, request);
  }

  @Patch('prices/:id')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({
    summary: 'Corrige un precio',
    description:
      'El combustible y la fecha de entrada en vigor identifican la fila y no se pueden ' +
      'cambiar: para rectificarlos, caduca este precio y crea otro.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFuelPriceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<FuelPrice> {
    return this.fuelService.update(id, dto, user, request);
  }

  @Patch('prices/:id/expire')
  @Roles(Role.Admin, Role.Dispatcher)
  @ApiOperation({
    summary: 'Caduca un precio con fecha de hoy',
    description: 'No se borra: es la justificación de los costes ya calculados con él.',
  })
  async expire(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<FuelPrice> {
    return this.fuelService.expire(id, user, request);
  }
}
