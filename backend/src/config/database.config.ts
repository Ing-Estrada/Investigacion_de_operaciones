import { registerAs } from '@nestjs/config';

import { toBool } from './env.validation';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  poolSize: number;
  /** `synchronize` jamás se activa: el esquema lo gobiernan las migraciones. */
  synchronize: false;
  logging: boolean;
}

export default registerAs<DatabaseConfig>('database', () => ({
  host: process.env.DB_HOST as string,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME as string,
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME as string,
  ssl: toBool(process.env.DB_SSL),
  poolSize: Number(process.env.DB_POOL_SIZE ?? 20),
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
}));
