import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { RequestWithUser } from '@/common/types/authenticated-user';

/** Umbral a partir del cual una petición se considera lenta (RNF-009: latencia < 500 ms). */
const SLOW_REQUEST_MS = 500;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url } = request;
    const startedAt = process.hrtime.bigint();

    // Nunca se registra el body: contiene contraseñas en /auth/login y /auth/register.
    const actor = request.user ? `user=${request.user.id}` : 'anon';

    return next.handle().pipe(
      tap(() => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const line = `${method} ${url} ${response.statusCode} ${elapsedMs.toFixed(1)}ms ${actor}`;
        if (elapsedMs > SLOW_REQUEST_MS) {
          this.logger.warn(`SLOW ${line}`);
        } else {
          this.logger.log(line);
        }
      }),
      catchError((error: unknown) => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        this.logger.warn(`${method} ${url} FAILED ${elapsedMs.toFixed(1)}ms ${actor}`);
        return throwError(() => error);
      }),
    );
  }
}
