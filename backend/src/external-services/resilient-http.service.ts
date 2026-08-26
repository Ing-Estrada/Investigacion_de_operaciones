import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

import { CircuitOpenException, ExternalApiException } from '@/common/exceptions/domain.exceptions';
import externalApisConfig from '@/config/external-apis.config';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreaker {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
}

/**
 * Cliente HTTP para proveedores externos con timeout, reintentos y circuit breaker.
 *
 * Los tres mecanismos resuelven problemas distintos y ninguno sustituye a los otros:
 *  - el timeout evita que una petición colgada consuma un worker indefinidamente;
 *  - los reintentos absorben fallos transitorios (un 503 puntual, un corte de red);
 *  - el circuit breaker evita que, cuando el proveedor está realmente caído, cada
 *    petición entrante gaste 3 reintentos x 8 s antes de fallar — eso convierte la
 *    caída del proveedor en la caída de nuestro servicio.
 */
@Injectable()
export class ResilientHttpService {
  private readonly logger = new Logger(ResilientHttpService.name);
  private readonly client: AxiosInstance;
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    @Inject(externalApisConfig.KEY)
    private readonly config: ConfigType<typeof externalApisConfig>,
  ) {
    this.client = axios.create({
      timeout: config.timeoutMs,
      // Un 4xx es una respuesta legítima que queremos inspeccionar, no una excepción de red.
      validateStatus: (status) => status < 500,
    });
  }

  async request<T>(provider: string, requestConfig: AxiosRequestConfig): Promise<T> {
    this.assertCircuitClosed(provider);

    const { attempts, baseDelayMs, maxDelayMs } = this.config.retry;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.client.request<T>(requestConfig);

        if (response.status >= 400) {
          // Los 4xx no se reintentan: la petición es incorrecta y repetirla dará igual.
          this.recordSuccess(provider);
          throw new ExternalApiException(
            provider,
            `Respuesta ${response.status}: ${this.describe(response.data)}`,
          );
        }

        this.recordSuccess(provider);
        return response.data;
      } catch (error) {
        if (error instanceof ExternalApiException) throw error;

        lastError = error;
        const retryable = this.isRetryable(error);

        if (!retryable || attempt === attempts) break;

        const delay = this.backoffDelay(attempt, baseDelayMs, maxDelayMs, error);
        this.logger.warn(
          `[${provider}] intento ${attempt}/${attempts} fallido ` +
            `(${(error as Error).message}). Reintentando en ${delay} ms.`,
        );
        await sleep(delay);
      }
    }

    this.recordFailure(provider);
    throw new ExternalApiException(
      provider,
      `No hubo respuesta tras ${attempts} intentos: ${(lastError as Error)?.message ?? 'error desconocido'}`,
      lastError,
    );
  }

  /** Estado de los circuitos, para exponerlo en el health check. */
  circuitSnapshot(): Record<string, CircuitState> {
    const snapshot: Record<string, CircuitState> = {};
    for (const [provider, breaker] of this.breakers) {
      snapshot[provider] = this.currentState(provider, breaker);
    }
    return snapshot;
  }

  private assertCircuitClosed(provider: string): void {
    const breaker = this.breakers.get(provider);
    if (!breaker) return;

    const state = this.currentState(provider, breaker);
    if (state === 'open') {
      const remaining = this.config.circuitBreaker.openDurationMs - (Date.now() - breaker.openedAt);
      throw new CircuitOpenException(provider, Math.max(0, remaining));
    }
  }

  /**
   * Transición automática de `open` a `half-open` una vez cumplido el tiempo de espera:
   * la siguiente petición actúa como sonda. Si funciona, el circuito se cierra; si
   * falla, vuelve a abrirse el periodo completo.
   */
  private currentState(_provider: string, breaker: CircuitBreaker): CircuitState {
    if (breaker.state !== 'open') return breaker.state;

    if (Date.now() - breaker.openedAt >= this.config.circuitBreaker.openDurationMs) {
      breaker.state = 'half-open';
      return 'half-open';
    }

    return 'open';
  }

  private recordSuccess(provider: string): void {
    const breaker = this.breakers.get(provider);
    if (!breaker) return;

    if (breaker.state !== 'closed') {
      this.logger.log(`[${provider}] circuito cerrado de nuevo.`);
    }
    breaker.state = 'closed';
    breaker.consecutiveFailures = 0;
  }

  private recordFailure(provider: string): void {
    const breaker = this.breakers.get(provider) ?? {
      state: 'closed' as CircuitState,
      consecutiveFailures: 0,
      openedAt: 0,
    };

    breaker.consecutiveFailures += 1;

    if (breaker.consecutiveFailures >= this.config.circuitBreaker.failureThreshold) {
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      this.logger.error(
        `[${provider}] circuito ABIERTO tras ${breaker.consecutiveFailures} fallos consecutivos. ` +
          `Se rechazarán las peticiones durante ${this.config.circuitBreaker.openDurationMs} ms.`,
      );
    }

    this.breakers.set(provider, breaker);
  }

  /** Solo se reintentan errores de red, timeouts y 5xx. */
  private isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;

    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') return true;
    if (!axiosError.response) return true;

    return axiosError.response.status >= 500 || axiosError.response.status === 429;
  }

  /**
   * Backoff exponencial con jitter. El jitter no es un detalle estético: sin él, N
   * clientes que fallan a la vez reintentan a la vez y vuelven a tumbar al proveedor
   * justo cuando se estaba recuperando.
   */
  private backoffDelay(attempt: number, baseMs: number, maxMs: number, error: unknown): number {
    // Si el proveedor indica cuándo reintentar, se le hace caso.
    if (axios.isAxiosError(error)) {
      const retryAfter = error.response?.headers?.['retry-after'];
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, maxMs);
      }
    }

    const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
    return Math.round(exponential * (0.5 + Math.random() * 0.5));
  }

  private describe(data: unknown): string {
    if (typeof data === 'string') return data.slice(0, 200);
    try {
      return JSON.stringify(data).slice(0, 200);
    } catch {
      return '[respuesta no serializable]';
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
