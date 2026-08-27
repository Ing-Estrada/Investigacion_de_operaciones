import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import costModelConfig from '@/config/cost-model.config';
import { ExternalServicesModule } from '@/external-services/external-services.module';
import { FuelModule } from '@/modules/fuel/fuel.module';
import { IncidentsModule } from '@/modules/incidents/incidents.module';
import { TollsModule } from '@/modules/tolls/tolls.module';
import { VehiclesModule } from '@/modules/vehicles/vehicles.module';
import { WeatherModule } from '@/modules/weather/weather.module';

import { AStarAlgorithm } from './algorithms/astar.algorithm';
import { DijkstraAlgorithm } from './algorithms/dijkstra.algorithm';
import { RouteOptimizerService } from './algorithms/route-optimizer.service';
import { YenKShortestPaths } from './algorithms/yen-k-shortest.algorithm';
import { Route } from './entities/route.entity';
import { RouteSegment } from './entities/route-segment.entity';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GraphBuilderService } from './services/graph-builder.service';
import { RouteEnrichmentService } from './services/route-enrichment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Route, RouteSegment]),
    ConfigModule.forFeature(costModelConfig),
    ExternalServicesModule,
    VehiclesModule,
    WeatherModule,
    IncidentsModule,
    TollsModule,
    FuelModule,
  ],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    GraphBuilderService,
    RouteEnrichmentService,
    RouteOptimizerService,
    DijkstraAlgorithm,
    AStarAlgorithm,
    YenKShortestPaths,
  ],
  exports: [RoutesService, TypeOrmModule],
})
export class RoutesModule {}
