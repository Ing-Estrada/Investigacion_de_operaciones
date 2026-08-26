import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '@/common/decorators';

/**
 * Guard JWT global. Aplica a todo salvo lo marcado con `@Public()`, de modo que el
 * fallo por omisión sea denegar el acceso.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    if (err || !user) {
      // El motivo concreto (token expirado, firma inválida, usuario inactivo) se queda
      // en el servidor: distinguirlos ayuda a un atacante a afinar el ataque.
      const reason = info instanceof Error ? info.message : 'token inválido';
      throw err instanceof Error
        ? err
        : new UnauthorizedException({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Credenciales inválidas o sesión expirada.',
            detail: process.env.NODE_ENV === 'development' ? reason : undefined,
          });
    }
    return user;
  }
}
