import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { RateLimit } from '@/common/decorators';
import {
  GeocodingResult,
  NominatimGeocodingProvider,
} from '@/external-services/geocoding/nominatim.provider';

export class SearchQueryDto {
  @ApiProperty({ example: 'Pitalito, Huila' })
  @IsString()
  @MinLength(3, { message: 'La búsqueda necesita al menos 3 caracteres.' })
  @MaxLength(200)
  query: string;

  @ApiPropertyOptional({ default: 5, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class ReverseQueryDto {
  @ApiProperty({ example: 1.8536 })
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -76.0511 })
  @Type(() => Number)
  @IsLongitude()
  longitude: number;
}

@ApiTags('Geocoding')
@ApiBearerAuth('JWT')
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocoding: NominatimGeocodingProvider) {}

  @Get('search')
  // La instancia pública de Nominatim admite ~1 req/s; este límite protege su cuota
  // tanto como la nuestra. El autocompletado del frontend además va con debounce.
  @RateLimit({ limit: 30, windowSec: 60 })
  @ApiOperation({
    summary: 'Busca coordenadas a partir de una dirección o topónimo',
    description: 'Alimenta el autocompletado de origen y destino.',
  })
  async search(@Query() query: SearchQueryDto): Promise<GeocodingResult[]> {
    return this.geocoding.search(query.query, query.limit ?? 5);
  }

  @Get('reverse')
  @RateLimit({ limit: 30, windowSec: 60 })
  @ApiOperation({ summary: 'Obtiene la dirección de unas coordenadas' })
  async reverse(@Query() query: ReverseQueryDto): Promise<{ address: string | null }> {
    const address = await this.geocoding.reverse({
      latitude: query.latitude,
      longitude: query.longitude,
    });
    return { address };
  }
}
