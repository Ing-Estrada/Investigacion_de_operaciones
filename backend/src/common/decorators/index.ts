import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

import { Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Marca un endpoint como accesible sin autenticación.
 *
 * El guard JWT está registrado globalmente, así que el modo por defecto es "cerrado":
 * olvidarse de este decorador deja el endpoint protegido, no abierto.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe un endpoint a los roles indicados (RF-017). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface RateLimitOptions {
  /** Peticiones permitidas dentro de la ventana. */
  limit: number;
  /** Duración de la ventana en segundos. */
  windowSec: number;
  /** Si es true, la cuota se cuenta por IP aunque el usuario esté autenticado. */
  byIpOnly?: boolean;
}

/** Sobrescribe el límite global para un endpoint concreto (RNF-006). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** Inyecta el usuario autenticado, o una de sus propiedades. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
