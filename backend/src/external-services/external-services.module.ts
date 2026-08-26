import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import cacheConfig from '@/config/cache.config';
import { RoutingProvider as ProviderEnum } from '@/config/env.validation';
import externalApisConfig from '@/config/external-apis.config';

import { NominatimGeocodingProvider } from './geocoding/nominatim.provider';
import { ResilientHttpService } from './resilient-http.service';
import { OsrmRoutingProvider } from './routing/osrm.provider';
import { ROUTING_PROVIDER } from './routing/routing.provider';

/**
 * El proveedor de red vial se resuelve en el arranque.
 *
 * Solo hay implementación de OSRM: es abierto, gratuito y no requiere clave, y la
 * especificación admite explícitamente usar cartografía libre. La interfaz
 * `RoutingProvider` deja preparada la incorporación de Google Directions sin tocar
 * nada aguas arriba; si se selecciona `google` sin haberla implementado, el arranque
 * falla de forma explícita en lugar de degradarse en silencio.
 */
const routingProvider: Provider = {
  provide: ROUTING_PROVIDER,
  inject: [ConfigService, OsrmRoutingProvider],
  useFactory: (configService: ConfigService, osrm: OsrmRoutingProvider) => {
    const selected = configService.get<string>('ROUTING_PROVIDER') ?? ProviderEnum.Osrm;

    if (selected === ProviderEnum.Google) {
      throw new Error(
        'ROUTING_PROVIDER=google todavía no tiene implementación. ' +
          'Usa ROUTING_PROVIDER=osrm o añade un GoogleRoutingProvider que implemente RoutingProvider.',
      );
    }

    return osrm;
  },
};

@Module({
  imports: [ConfigModule.forFeature(externalApisConfig), ConfigModule.forFeature(cacheConfig)],
  providers: [
    ResilientHttpService,
    OsrmRoutingProvider,
    NominatimGeocodingProvider,
    routingProvider,
  ],
  // RedisService no se exporta aquí: lo provee RedisModule, que es global.
  exports: [ResilientHttpService, ROUTING_PROVIDER, NominatimGeocodingProvider],
})
export class ExternalServicesModule {}
