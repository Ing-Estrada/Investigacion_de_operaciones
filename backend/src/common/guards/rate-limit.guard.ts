import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';

import { RATE_LIMIT_KEY, RateLimitOptions } from '@/common/decorators';
import { RateLimitExceededException } from '@/common/exceptions/domain.exceptions';
import { RequestWithUser } from '@/common/types/authenticated-user';
import securityConfig from '@/config/security.config';
import { RedisService } from '@/infrastructure/redis/redis.service';

/**
 * Rate limiting distribuido sobre Redis (RNF-006).
 *
 * La cuota se cuenta por (identidad, endpoint): una IP no puede agotar la cuota de
 * login de todo el mundo, y un usuario autenticado no comparte cuota con el resto de
 * la NAT desde la que sale.
 *
 * Si Redis cae, el guard deja pasar (fail-open) y lo registra como error. Es una
 * decisión consciente: NGINX mantiene un límite en el borde (ver infra/nginx/nginx.conf),
 * así que la protección no desaparece, y cerrar aquí convertiría una caída de la caché
 * en una caída total del servicio.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(securityConfig.KEY) private readonly config: ConfigType<typeof securityConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? {
      limit: this.config.rateLimit.defaultMax,
      windowSec: this.config.rateLimit.defaultWindowSec,
    };

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = this.buildKey(request, options);
    const result = await this.redis.consumeRateLimit(key, options.windowSec);

    if (result.degraded) {
      this.logger.error(
        `Rate limiting degradado (Redis no disponible) en ${request.method} ${request.url}. ` +
          'El límite del borde (NGINX) sigue activo.',
      );
      return true;
    }

    const remaining = Math.max(0, options.limit - result.current);
    response.setHeader('X-RateLimit-Limit', options.limit.toString());
    response.setHeader('X-RateLimit-Remaining', remaining.toString());
    response.setHeader('X-RateLimit-Reset', (Date.now() + result.ttlSec * 1000).toString());

    if (result.current > options.limit) {
      throw new RateLimitExceededException(result.ttlSec);
    }

    return true;
  }

  private buildKey(request: RequestWithUser, options: RateLimitOptions): string {
    const route = `${request.method}:${request.route?.path ?? request.url.split('?')[0]}`;
    const identity =
      !options.byIpOnly && request.user ? `user:${request.user.id}` : `ip:${this.clientIp(request)}`;
    return `ratelimit:${identity}:${route}`;
  }

  /**
   * IP real del cliente. Detrás de NGINX, `req.ip` es la del proxy; Express resuelve
   * X-Forwarded-For correctamente solo si `trust proxy` está configurado (ver main.ts).
   */
  private clientIp(request: RequestWithUser): string {
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }
}
