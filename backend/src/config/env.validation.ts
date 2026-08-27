import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum RoutingProvider {
  Osrm = 'osrm',
  Google = 'google',
}

export enum WeatherProvider {
  OpenWeather = 'openweather',
  None = 'none',
}

/**
 * Contrato de variables de entorno. Se valida una sola vez al arrancar el proceso:
 * si falta un secreto o un valor es inválido, el proceso muere en el boot en lugar de
 * fallar impredeciblemente en runtime.
 *
 * Los campos numéricos llevan `@Type(() => Number)` explícito y no confían en la
 * conversión implícita de class-transformer. Esa conversión se apoya en la metadata
 * `design:type` que emite el compilador, y cualquier pipeline que transpile sin
 * información de tipos —ts-jest en modo aislado, SWC, esbuild— la emite como `Object`.
 * El resultado es que `PORT` sigue siendo la cadena "3001", `@IsInt()` falla y el
 * proceso no arranca. El decorador explícito no depende de la metadata y funciona igual
 * con cualquier compilador.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsString()
  @IsOptional()
  API_PREFIX = 'api/v1';

  // --- Base de datos -------------------------------------------------------
  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsOptional()
  @IsBooleanString()
  DB_SSL?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DB_POOL_SIZE = 20;

  // --- Redis ---------------------------------------------------------------
  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT = 6379;

  @IsString()
  REDIS_PASSWORD = '';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  REDIS_DB = 0;

  // --- Seguridad -----------------------------------------------------------
  /** RNF: mínimo 32 caracteres. HS256 con un secreto corto es trivialmente atacable. */
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres' })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres' })
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  JWT_REFRESH_TTL = '7d';

  @IsString()
  COOKIE_DOMAIN = 'localhost';

  /** Lista separada por comas. Nunca se permite `*` cuando credentials=true. */
  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_DEFAULT_MAX = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_DEFAULT_WINDOW_SEC = 60;

  // --- Proveedores externos ------------------------------------------------
  @IsEnum(RoutingProvider)
  ROUTING_PROVIDER: RoutingProvider = RoutingProvider.Osrm;

  @IsUrl({ require_tld: false })
  OSRM_BASE_URL = 'http://router.project-osrm.org';

  @IsUrl({ require_tld: false })
  NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

  @IsString()
  @IsNotEmpty()
  NOMINATIM_USER_AGENT = 'route-optimizer/1.0';

  @IsOptional()
  @IsString()
  GOOGLE_MAPS_API_KEY?: string;

  @IsEnum(WeatherProvider)
  WEATHER_PROVIDER: WeatherProvider = WeatherProvider.OpenWeather;

  @IsOptional()
  @IsString()
  OPENWEATHER_API_KEY?: string;

  @IsUrl({ require_tld: false })
  OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

  @Type(() => Number)
  @IsInt()
  @Min(100)
  EXTERNAL_API_TIMEOUT_MS = 8000;

  // --- Modelo de costos ----------------------------------------------------
  @IsString()
  DEFAULT_CURRENCY = 'USD';
}

/** Convierte "true"/"1" a boolean; cualquier otra cosa es false. */
export function toBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

/**
 * Hook de validación de `ConfigModule.forRoot`. Los valores llegan siempre como string
 * desde `process.env`, por eso `enableImplicitConversion`.
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const detail = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detail}`);
  }

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos: compartirlos permite ' +
        'usar un refresh token como access token.',
    );
  }

  if (config.NODE_ENV === NodeEnv.Production) {
    if (config.WEATHER_PROVIDER === WeatherProvider.OpenWeather && !config.OPENWEATHER_API_KEY) {
      throw new Error('OPENWEATHER_API_KEY es obligatoria cuando WEATHER_PROVIDER=openweather');
    }
    if (config.ROUTING_PROVIDER === RoutingProvider.Google && !config.GOOGLE_MAPS_API_KEY) {
      throw new Error('GOOGLE_MAPS_API_KEY es obligatoria cuando ROUTING_PROVIDER=google');
    }
    if (config.CORS_ORIGINS.includes('*')) {
      throw new Error('CORS_ORIGINS no puede contener "*" en producción (credentials: true)');
    }
  }

  return config;
}
