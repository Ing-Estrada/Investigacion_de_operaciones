import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface ErrorResponseBody {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
  [key: string]: unknown;
}

/** Códigos SQLSTATE de PostgreSQL que sí sabemos traducir a un error de cliente. */
const PG_ERROR_CODES: Record<string, { status: HttpStatus; error: string; message: string }> = {
  '23505': {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'Ya existe un registro con esos datos.',
  },
  '23503': {
    status: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: 'La operación referencia un registro que no existe.',
  },
  '23514': {
    status: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: 'Los datos violan una restricción de negocio.',
  },
  '22P02': {
    status: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: 'Formato de dato inválido.',
  },
};

/**
 * Filtro global de errores.
 *
 * Su función de seguridad principal es que ningún detalle interno —stack traces, SQL,
 * nombres de constraint— llegue al cliente. Todo eso va al log del servidor; el cliente
 * recibe un mensaje genérico y un `requestId` con el que soporte puede encontrar la traza.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string) ?? undefined;

    const body = this.buildBody(exception, request, requestId);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${body.statusCode}: ${JSON.stringify(body.message)}`,
      );
    }

    // 429 y 503 deben decirle al cliente cuándo reintentar.
    const retryAfterSec =
      body.retryAfterSec ?? (body.retryAfterMs ? Number(body.retryAfterMs) / 1000 : undefined);
    if (typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec)) {
      response.setHeader('Retry-After', Math.ceil(retryAfterSec).toString());
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(
    exception: unknown,
    request: Request,
    requestId: string | undefined,
  ): ErrorResponseBody & { retryAfterSec?: number; retryAfterMs?: number } {
    const base = {
      success: false as const,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { ...base, statusCode: status, error: exception.name, message: payload };
      }

      const record = payload as Record<string, unknown>;
      return {
        ...base,
        ...record,
        statusCode: status,
        error: (record.error as string) ?? exception.name,
        message: (record.message as string | string[]) ?? 'Error',
      };
    }

    if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code;
      const mapped = code ? PG_ERROR_CODES[code] : undefined;

      if (mapped) {
        return { ...base, statusCode: mapped.status, error: mapped.error, message: mapped.message };
      }

      // Un error SQL no mapeado es un bug nuestro; nunca se expone el mensaje del driver.
      return {
        ...base,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'Error al acceder a los datos.',
      };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Ha ocurrido un error inesperado.',
    };
  }
}
