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

import { CurrentUser, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

import { BoundingBoxQueryDto, CreateIncidentDto, UpdateIncidentDto } from './dto/incident.dto';
import { RoadIncident } from './entities/road-incident.entity';
import { IncidentsService } from './incidents.service';

@ApiTags('Incidents')
@ApiBearerAuth('JWT')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Incidentes activos dentro de un rectángulo geográfico',
    description: 'Pensado para la capa de incidentes del mapa. Cualquier rol autenticado.',
  })
  async findInBoundingBox(@Query() bbox: BoundingBoxQueryDto): Promise<RoadIncident[]> {
    return this.incidentsService.findInBoundingBox(bbox);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un incidente' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoadIncident> {
    return this.incidentsService.findOne(id);
  }

  @Post()
  @Roles(Role.Dispatcher, Role.Admin)
  @ApiOperation({ summary: 'Registra un incidente vial' })
  async create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<RoadIncident> {
    return this.incidentsService.create(dto, user, request);
  }

  @Patch(':id')
  @Roles(Role.Dispatcher, Role.Admin)
  @ApiOperation({
    summary: 'Actualiza un incidente',
    description: 'Poner `isActive: false` es la forma de darlo por resuelto.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<RoadIncident> {
    return this.incidentsService.update(id, dto, user, request);
  }
}
