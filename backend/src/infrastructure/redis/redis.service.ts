import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';

import cacheConfig from '@/config/cache.config';

export interface RateLimitResult {
  /** Peticiones consumidas en la ventana actual. */
  current: number;
  /** Segundos que faltan para que la ventana se reinicie. */
  ttlSec: number;
  /** true si Redis no estaba disponible y la decisión se tomó sin datos. */
  degraded: boolean;
}

/**
 * Script Lua para el contador de ventana fija. Se ejecuta atómicamente en el servidor:
 * hacer INCR y EXPIRE como dos comandos separados abre una ventana en la que un fallo
 * entre ambos deja la clave sin TTL, bloqueando a esa IP para siempre.
 */
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('TTL', KEYS[1]) }
`;

/**
 * Cliente Redis compartido: caché distribuida (RNF-011) y rate limiting (RNF-006).
 *
 * Todas las operaciones de caché degradan a "miss" si Redis no responde. Una caché
 * caída debe encarecer las peticiones, no tumbar el servicio (RNF-016).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private available = false;

  constructor(
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
  ) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password || undefined,
      db: config.db,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('ready', () => {
      this.available = true;
      this.logger.log(`Redis conectado en ${config.host}:${config.port}`);
    });

    this.client.on('error', (error: Error) => {
      if (this.available) {
        this.logger.error(`Conexión Redis perdida: ${error.message}`);
      }
      this.available = false;
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      // No abortamos el arranque: la app funciona sin caché, más lenta.
      this.logger.error(
        `No se pudo conectar a Redis en el arranque: ${(error as Error).message}. ` +
          'La aplicación continúa sin caché distribuida.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Acceso directo al cliente, para tests y health checks. */
  get raw(): Redis {
    return this.client;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Fallo leyendo la clave "${key}": ${(error as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    if (!this.available) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (error) {
      this.logger.warn(`Fallo escribiendo la clave "${key}": ${(error as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.available || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`Fallo borrando claves: ${(error as Error).message}`);
    }
  }

  /**
   * Cache-aside: devuelve el valor cacheado o ejecuta `factory` y lo guarda.
   *
   * Si `factory` lanza, el error se propaga y no se cachea nada: cachear un fallo
   * transitorio de un proveedor externo lo convertiría en un fallo persistente.
   */
  async wrap<T>(key: string, ttlSec: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;

    const fresh = await factory();
    await this.setJson(key, fresh, ttlSec);
    return fresh;
  }

  /**
   * Incrementa el contador de una ventana y devuelve el estado.
   *
   * Si Redis está caído devuelve `degraded: true` con contador 1; la decisión de
   * permitir o denegar en ese caso la toma el guard, no este servicio.
   */
  async consumeRateLimit(key: string, windowSec: number): Promise<RateLimitResult> {
    if (!this.available) {
      return { current: 1, ttlSec: windowSec, degraded: true };
    }

    try {
      const result = (await this.client.eval(RATE_LIMIT_SCRIPT, 1, key, windowSec)) as [
        number,
        number,
      ];
      return { current: Number(result[0]), ttlSec: Number(result[1]), degraded: false };
    } catch (error) {
      this.logger.error(`Fallo en el rate limiter: ${(error as Error).message}`);
      return { current: 1, ttlSec: windowSec, degraded: true };
    }
  }

  /** Borra todas las claves que empiezan por el prefijo, con SCAN para no bloquear Redis. */
  async deleteByPrefix(prefix: string): Promise<number> {
    if (!this.available) return 0;

    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
