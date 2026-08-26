import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

// El CLI de TypeORM no pasa por el ConfigModule de Nest, así que carga el .env por su cuenta.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

/**
 * DataSource para el CLI de TypeORM (generar y ejecutar migraciones).
 *
 * Es deliberadamente independiente del contenedor de Nest: arrancar la aplicación
 * entera —con Redis, proveedores externos y guards— solo para aplicar una migración
 * haría que un fallo en cualquiera de esas piezas impidiera migrar la base de datos.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'routeopt',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'route_optimizer',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
