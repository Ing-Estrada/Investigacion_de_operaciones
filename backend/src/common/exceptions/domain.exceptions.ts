import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Un proveedor externo falló o no respondió a tiempo.
 *
 * 502 y no 500: el fallo no es nuestro, y la distinción importa para las alertas —
 * un pico de 502 apunta al proveedor, un pico de 500 apunta a nuestro código.
 */
export class ExternalApiException extends HttpException {
  // No se llama `cause`: `Error.cause` ya existe en la clase base y redeclararlo como
  // opcional rompe la compatibilidad del tipo.
  constructor(
    readonly provider: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'External API Error',
        message: `[${provider}] ${message}`,
        provider,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** El circuito está abierto: se rechaza sin llamar al proveedor. */
export class CircuitOpenException extends HttpException {
  constructor(
    readonly provider: string,
    retryAfterMs: number,
  ) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Circuit Open',
        message: `El proveedor "${provider}" está temporalmente fuera de servicio.`,
        retryAfterMs,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** No existe camino entre origen y destino en la red vial disponible. */
export class RouteNotFoundException extends HttpException {
  constructor(message = 'No existe una ruta transitable entre el origen y el destino.') {
    super(
      { statusCode: HttpStatus.UNPROCESSABLE_ENTITY, error: 'Route Not Found', message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** El vehículo no puede circular por la ruta (altura, peso, ancho o restricción horaria). */
export class VehicleRestrictionException extends HttpException {
  constructor(
    message: string,
    readonly restrictions: string[] = [],
  ) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Vehicle Restriction',
        message,
        restrictions,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** Cuota de peticiones agotada. */
export class RateLimitExceededException extends HttpException {
  constructor(readonly retryAfterSec: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Has superado el límite de peticiones. Inténtalo de nuevo más tarde.',
        retryAfterSec,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Cuenta bloqueada por intentos fallidos consecutivos. */
export class AccountLockedException extends HttpException {
  constructor(until: Date) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Account Locked',
        message: 'Cuenta bloqueada temporalmente por intentos de acceso fallidos.',
        lockedUntil: until.toISOString(),
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
