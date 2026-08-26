import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
  path: string;
}

/**
 * Rutas que devuelven su propio contrato y no deben envolverse: el formato de
 * `/health` lo consumen los orquestadores (Docker, Kubernetes) y no es negociable.
 */
const UNWRAPPED_PATHS = ['/health', '/health/live', '/health/ready', '/metrics'];

/** Uniforma la forma de todas las respuestas correctas; el filtro de errores hace lo propio con los fallos. */
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.url.split('?')[0];

    if (UNWRAPPED_PATHS.some((p) => path.endsWith(p))) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        timestamp: new Date().toISOString(),
        path: request.url,
      })),
    );
  }
}
