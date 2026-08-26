import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { TollCategory } from '@/common/enums';

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
}
