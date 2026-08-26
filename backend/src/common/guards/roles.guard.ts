import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, ROLES_KEY } from '@/common/decorators';
import { Role } from '@/common/enums';
import { RequestWithUser } from '@/common/types/authenticated-user';
import { AuditService } from '@/modules/audit/audit.service';

/**
 * Control de acceso basado en roles (RF-017).
 *
 * Un intento denegado se registra en auditoría (RF-018): es la señal temprana de una
 * cuenta comprometida o de una escalada de privilegios en curso.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin @Roles el endpoint solo exige estar autenticado, de lo que ya se ocupa JwtAuthGuard.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Se requiere autenticación para este recurso.');
    }

    if (requiredRoles.includes(user.role)) return true;

    // Fire-and-forget: la auditoría no debe retrasar ni romper la respuesta de rechazo.
    void this.auditService.recordAccessDenied({
      user,
      resource: `${request.method} ${request.url}`,
      requiredRoles,
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'],
    });

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Tu rol no tiene permiso para realizar esta acción.',
      requiredRoles,
    });
  }
}
