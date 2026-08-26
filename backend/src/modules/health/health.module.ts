import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ExternalServicesModule } from '@/external-services/external-services.module';

import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, ExternalServicesModule],
  controllers: [HealthController],
})
export class HealthModule {}
