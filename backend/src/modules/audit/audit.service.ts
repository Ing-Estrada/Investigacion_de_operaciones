import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { AuditAction, Role } from '@/common/enums';
import { AuthenticatedUser } from '@/common/types/authenticated-user';

import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  success?: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Claves que jamás se persisten en auditoría, ni siquiera cifradas. La lista se aplica
 * en profundidad y por coincidencia parcial: `newPassword`, `password_hash`,
 * `refreshToken` y `apiKey` caen todas aquí.
 */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'hash',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'creditcard',
];

const MAX_USER_AGENT_LENGTH = 255;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Persiste una entrada de auditoría.
   *
   * Nunca lanza: si la auditoría fallara y propagara el error, un problema de escritura
   * en esta tabla tumbaría operaciones de negocio que sí han tenido éxito. El fallo se
   * registra en el log de aplicación, que es la red de seguridad.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const log = this.auditRepository.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        userId: entry.userId ?? null,
        userEmail: entry.userEmail ?? null,
        oldValues: this.sanitize(entry.oldValues),
        newValues: this.sanitize(entry.newValues),
        success: entry.success ?? true,
        reason: entry.reason ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      });
      await this.auditRepository.save(log);
    } catch (error) {
      this.logger.error(
        `No se pudo escribir la entrada de auditoría (${entry.action} sobre ${entry.entityType}): ` +
          `${(error as Error).message}`,
      );
    }
  }

  async recordAccessDenied(params: {
    user: AuthenticatedUser;
    resource: string;
    requiredRoles: Role[];
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.record({
      action: AuditAction.AccessDenied,
      entityType: 'authorization',
      userId: params.user.id,
      userEmail: params.user.email,
      success: false,
      reason: `Rol "${params.user.role}" insuficiente para ${params.resource}`,
      newValues: { requiredRoles: params.requiredRoles, resource: params.resource },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  /**
   * Elimina recursivamente los valores sensibles antes de persistir.
   * Los objetos se recorren en profundidad porque un DTO anidado puede esconder
   * una contraseña dos niveles más abajo.
   */
  sanitize(values: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!values) return null;
    return this.sanitizeValue(values, 0) as Record<string, unknown>;
  }

  private sanitizeValue(value: unknown, depth: number): unknown {
    // Corta ciclos y estructuras patológicas.
    if (depth > 6) return '[truncated]';

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, depth + 1));
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      const result: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        result[key] = REDACTED_KEYS.some((redacted) => normalized.includes(redacted))
          ? '[REDACTED]'
          : this.sanitizeValue(inner, depth + 1);
      }
      return result;
    }

    return value;
  }

  /**
   * IP del cliente. `request.ip` ya resuelve X-Forwarded-For cuando `trust proxy` está
   * activo; el fallback cubre las pruebas y las conexiones directas.
   */
  extractIp(request: Request): string | null {
    const ip = request.ip ?? request.socket?.remoteAddress ?? null;
    if (!ip) return null;
    // Postgres INET rechaza el prefijo IPv4-mapped de IPv6 que emite Node.
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
}
