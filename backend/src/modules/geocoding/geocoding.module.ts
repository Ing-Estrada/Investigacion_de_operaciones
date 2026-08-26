import { Module } from '@nestjs/common';

import { ExternalServicesModule } from '@/external-services/external-services.module';

import { GeocodingController } from './geocoding.controller';

@Module({
  imports: [ExternalServicesModule],
  controllers: [GeocodingController],
})
export class GeocodingModule {}
