import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TollRate } from './entities/toll-rate.entity';
import { TollStation } from './entities/toll-station.entity';
import { TollsController } from './tolls.controller';
import { TollsService } from './tolls.service';

@Module({
  imports: [TypeOrmModule.forFeature([TollStation, TollRate])],
  controllers: [TollsController],
  providers: [TollsService],
  exports: [TollsService],
})
export class TollsModule {}
