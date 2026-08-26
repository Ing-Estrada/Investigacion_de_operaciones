import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from '@/common/interceptors/response-transform.interceptor';
import cacheConfig from '@/config/cache.config';
import costModelConfig from '@/config/cost-model.config';
import databaseConfig from '@/config/database.config';
import { validateEnv } from '@/config/env.validation';
import externalApisConfig from '@/config/external-apis.config';
import securityConfig from '@/config/security.config';
import { buildTypeOrmOptions } from '@/database/typeorm.factory';
import { ExternalServicesModule } from '@/external-services/external-services.module';
import { RedisModule } from '@/infrastructure/redis/redis.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { GeocodingModule } from '@/modules/geocoding/geocoding.module';
import { HealthModule } from '@/modules/health/health.module';
import { IncidentsModule } from '@/modules/incidents/incidents.module';
import { RoutesModule } from '@/modules/routes/routes.module';
import { TollsModule } from '@/modules/tolls/tolls.module';
import { UsersModule } from '@/modules/users/users.module';
import { VehiclesModule } from '@/modules/vehicles/vehicles.module';
import { WeatherModule } from '@/modules/weather/weather.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [databaseConfig, cacheConfig, securityConfig, externalApisConfig, costModelConfig],
      // El proceso no arranca si falta un secreto o un valor es inválido.
      validate: validateEnv,
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => buildTypeOrmOptions(configService),
    }),

    RedisModule,
    AuditModule,
    ExternalServicesModule,

    AuthModule,
    UsersModule,
    VehiclesModule,
    WeatherModule,
    TollsModule,
    IncidentsModule,
    RoutesModule,
    GeocodingModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    // El orden importa: los guards globales se ejecutan en el orden de declaración.
    // 1) Rate limit primero, para que una avalancha se corte antes de gastar CPU en
    //    verificar firmas JWT. 2) Autenticación. 3) Autorización por rol, que necesita
    //    el usuario ya resuelto por el guard anterior.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
  ],
})
export class AppModule {}
