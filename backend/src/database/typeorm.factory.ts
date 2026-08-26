import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';

/**
 * Opciones de TypeORM compartidas por la aplicación y por el CLI de migraciones.
 *
 * `synchronize` está desactivado siempre y sin excepción: en producción reescribiría el
 * esquema a partir de las entidades y puede llegar a borrar columnas con datos. El
 * esquema lo gobiernan exclusivamente las migraciones versionadas.
 */
export function buildTypeOrmOptions(configService: ConfigService): TypeOrmModuleOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  const useSsl = configService.get<string>('DB_SSL') === 'true';

  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST'),
    port: Number(configService.get<string>('DB_PORT') ?? 5432),
    username: configService.get<string>('DB_USERNAME'),
    password: configService.get<string>('DB_PASSWORD'),
    database: configService.get<string>('DB_NAME'),

    // Se cargan por glob para no tener que mantener una lista manual de entidades.
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],

    synchronize: false,
    migrationsRun: false,
    logging: isProduction ? ['error', 'warn'] : ['error', 'warn', 'migration'],

    // El pool acota las conexiones concurrentes: sin techo, un pico de tráfico agota
    // `max_connections` de Postgres y tumba también a los clientes ya conectados.
    poolSize: Number(configService.get<string>('DB_POOL_SIZE') ?? 20),
    extra: {
      max: Number(configService.get<string>('DB_POOL_SIZE') ?? 20),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    },

    ssl: useSsl ? { rejectUnauthorized: false } : false,
    autoLoadEntities: true,
  };
}
