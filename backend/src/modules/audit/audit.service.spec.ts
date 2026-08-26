import { Repository } from 'typeorm';

import { AuditAction } from '@/common/enums';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  // Se tipa como `jest.Mock` y no como `jest.Mocked<Repository>`: los métodos de
  // TypeORM están sobrecargados y forzar la firma completa en un doble de prueba
  // añade ruido sin aportar seguridad al test.
  let repository: { create: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    repository = {
      create: jest.fn((entity: Partial<AuditLog>) => entity as AuditLog),
      save: jest.fn(async (entity: Partial<AuditLog>) => entity as AuditLog),
    };
    service = new AuditService(repository as unknown as Repository<AuditLog>);
  });

  describe('sanitize', () => {
    it('devuelve null si no hay valores', () => {
      expect(service.sanitize(null)).toBeNull();
      expect(service.sanitize(undefined)).toBeNull();
    });

    it.each([
      'password',
      'newPassword',
      'password_hash',
      'passwordHash',
      'refreshToken',
      'accessToken',
      'apiKey',
      'api_key',
      'clientSecret',
      'Authorization',
      'cookie',
    ])('redacta la clave sensible "%s"', (key) => {
      const result = service.sanitize({ [key]: 'valor-secreto' });

      expect(result?.[key]).toBe('[REDACTED]');
      expect(JSON.stringify(result)).not.toContain('valor-secreto');
    });

    it('conserva los campos que no son sensibles', () => {
      const result = service.sanitize({ email: 'a@b.com', role: 'admin', distanceKm: 12 });

      expect(result).toEqual({ email: 'a@b.com', role: 'admin', distanceKm: 12 });
    });

    it('redacta también en objetos anidados', () => {
      const result = service.sanitize({
        user: { email: 'a@b.com', credentials: { password: 'secreta' } },
      });

      expect(JSON.stringify(result)).not.toContain('secreta');
    });

    it('redacta dentro de arrays', () => {
      const result = service.sanitize({
        sessions: [{ token: 'aaa' }, { token: 'bbb' }],
      });

      expect(JSON.stringify(result)).not.toContain('aaa');
      expect(JSON.stringify(result)).not.toContain('bbb');
    });

    it('corta las estructuras excesivamente profundas', () => {
      // Sin el corte, una estructura con referencias circulares colgaría el proceso.
      let deep: Record<string, unknown> = { value: 'fondo' };
      for (let i = 0; i < 20; i += 1) deep = { nested: deep };

      expect(() => service.sanitize(deep)).not.toThrow();
      expect(JSON.stringify(service.sanitize(deep))).toContain('[truncated]');
    });

    it('conserva las fechas sin destriparlas en un objeto', () => {
      const date = new Date('2026-01-01T00:00:00Z');
      const result = service.sanitize({ createdAt: date });

      expect(result?.createdAt).toBe(date);
    });
  });

  describe('record', () => {
    it('persiste la entrada con sus valores saneados', async () => {
      await service.record({
        action: AuditAction.Login,
        entityType: 'user',
        userId: 'user-1',
        userEmail: 'a@b.com',
        newValues: { password: 'secreta', email: 'a@b.com' },
      });

      expect(repository.save).toHaveBeenCalledTimes(1);
      const saved = repository.create.mock.calls[0][0] as Partial<AuditLog>;
      expect(saved.newValues).toEqual({ password: '[REDACTED]', email: 'a@b.com' });
    });

    it('trunca el user-agent al límite de la columna', async () => {
      await service.record({
        action: AuditAction.Login,
        entityType: 'user',
        userAgent: 'x'.repeat(500),
      });

      const saved = repository.create.mock.calls[0][0] as Partial<AuditLog>;
      expect(saved.userAgent).toHaveLength(255);
    });

    it('no propaga el error si falla la escritura', async () => {
      // Un fallo escribiendo auditoría no puede tumbar una operación de negocio que ya
      // se completó con éxito.
      repository.save.mockRejectedValueOnce(new Error('base de datos caída'));

      await expect(
        service.record({ action: AuditAction.Login, entityType: 'user' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('extractIp', () => {
    it('elimina el prefijo IPv4-mapped que Postgres INET rechaza', () => {
      const request = { ip: '::ffff:192.168.1.10', socket: {} } as never;
      expect(service.extractIp(request)).toBe('192.168.1.10');
    });

    it('devuelve la IP tal cual si ya es limpia', () => {
      const request = { ip: '203.0.113.7', socket: {} } as never;
      expect(service.extractIp(request)).toBe('203.0.113.7');
    });

    it('cae al socket cuando request.ip no está disponible', () => {
      const request = { socket: { remoteAddress: '10.0.0.1' } } as never;
      expect(service.extractIp(request)).toBe('10.0.0.1');
    });

    it('devuelve null si no hay ninguna IP', () => {
      const request = { socket: {} } as never;
      expect(service.extractIp(request)).toBeNull();
    });
  });
});
