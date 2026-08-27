import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FuelPrice } from './entities/fuel-price.entity';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';

@Module({
  imports: [TypeOrmModule.forFeature([FuelPrice])],
  controllers: [FuelController],
  providers: [FuelService],
  // Lo consume RoutesService para resolver el precio del combustible del vehículo.
  exports: [FuelService],
})
export class FuelModule {}
