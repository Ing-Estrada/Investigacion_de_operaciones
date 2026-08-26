import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AuditAction, Role } from '@/common/enums';
import { AccountLockedException } from '@/common/exceptions/domain.exceptions';
import { AuditService } from '@/modules/audit/audit.service';

import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const CONTEXT = { ipAddress: '203.0.113.5', userAgent: 'jest' };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'operador@example.com',
    passwordHash: 'hash',
    firstName: 'Ana',
    lastName: 'Torres',
    role: Role.Customer,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    tokensValidFrom: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    vehicles: [],
    fullName: 'Ana Torres',
    ...overrides,
  } as User;
}

describe('AuthService', () => {
  let service: AuthService;
  // Dobles con `jest.Mock` en vez de `jest.Mocked<T>`: los métodos de TypeORM están
  // sobrecargados y reproducir sus firmas completas en un mock no aporta nada al test.
  let userRepository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let passwordService: { hash: jest.Mock; verify: jest.Mock; verifyDummy: jest.Mock };
  let tokenService: { issueTokenPair: jest.Mock; revokeAllForUser: jest.Mock };
  let auditService: { record: jest.Mock };

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((entity: Partial<User>) => entity as User),
      save: jest.fn(async (entity: Partial<User>) => entity as User),
    };

    passwordService = {
      hash: jest.fn(async () => 'nuevo-hash'),
      verify: jest.fn(async () => true),
      verifyDummy: jest.fn(async () => false),
    };

    tokenService = {
      issueTokenPair: jest.fn(async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 900,
        refreshExpiresIn: 604_800,
      })),
      revokeAllForUser: jest.fn(async () => undefined),
    };

    auditService = { record: jest.fn(async () => undefined) };

    service = new AuthService(
      userRepository as unknown as Repository<User>,
      passwordService as unknown as PasswordService,
      tokenService as unknown as TokenService,
      auditService as unknown as AuditService,
    );
  });

  describe('register', () => {
    it('crea el usuario con rol customer y hashea la contraseña', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.register(
        {
          email: 'nueva@example.com',
          password: 'Sup3rS3gura!2026',
          firstName: 'Ana',
          lastName: 'Torres',
        },
        CONTEXT,
      );

      expect(passwordService.hash).toHaveBeenCalledWith('Sup3rS3gura!2026');
      // El rol nunca se toma del cuerpo de la petición: siempre es `customer`.
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.Customer, passwordHash: 'nuevo-hash' }),
      );
      expect(result.accessToken).toBe('access');
    });

    it('rechaza un email ya registrado sin revelar detalles adicionales', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      await expect(
        service.register(
          {
            email: 'operador@example.com',
            password: 'Sup3rS3gura!2026',
            firstName: 'Ana',
            lastName: 'Torres',
          },
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.Register, success: false }),
      );
    });
  });

  describe('login', () => {
    it('devuelve tokens con credenciales correctas y limpia el contador de fallos', async () => {
      const user = makeUser({ failedLoginAttempts: 3 });
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.login(
        { email: 'operador@example.com', password: 'correcta' },
        CONTEXT,
      );

      expect(result.accessToken).toBe('access');
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lastLoginAt).toBeInstanceOf(Date);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.Login }),
      );
    });

    it('con email inexistente consume el mismo tiempo que una verificación real', async () => {
      // Sin esto, la diferencia de latencia permite enumerar qué correos están registrados.
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nadie@example.com', password: 'x' }, CONTEXT),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(passwordService.verifyDummy).toHaveBeenCalledWith('x');
    });

    it('devuelve el mismo mensaje para email inexistente y contraseña incorrecta', async () => {
      userRepository.findOne.mockResolvedValue(null);
      const noUser = await service
        .login({ email: 'nadie@example.com', password: 'x' }, CONTEXT)
        .catch((error: Error) => error.message);

      userRepository.findOne.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(false);
      const badPassword = await service
        .login({ email: 'operador@example.com', password: 'x' }, CONTEXT)
        .catch((error: Error) => error.message);

      expect(noUser).toBe(badPassword);
    });

    it('incrementa el contador de intentos fallidos', async () => {
      const user = makeUser({ failedLoginAttempts: 1 });
      userRepository.findOne.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'operador@example.com', password: 'mala' }, CONTEXT),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(user.failedLoginAttempts).toBe(2);
    });

    it('bloquea la cuenta al llegar al quinto intento fallido', async () => {
      const user = makeUser({ failedLoginAttempts: 4 });
      userRepository.findOne.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'operador@example.com', password: 'mala' }, CONTEXT),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(user.lockedUntil).toBeInstanceOf(Date);
      expect((user.lockedUntil as Date).getTime()).toBeGreaterThan(Date.now());
      expect(user.failedLoginAttempts).toBe(0);
    });

    it('rechaza el acceso mientras la cuenta está bloqueada, aunque la contraseña sea correcta', async () => {
      const user = makeUser({ lockedUntil: new Date(Date.now() + 600_000) });
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: 'operador@example.com', password: 'correcta' }, CONTEXT),
      ).rejects.toBeInstanceOf(AccountLockedException);

      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('permite entrar de nuevo cuando el bloqueo ha expirado', async () => {
      const user = makeUser({ lockedUntil: new Date(Date.now() - 1000) });
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: 'operador@example.com', password: 'correcta' }, CONTEXT),
      ).resolves.toMatchObject({ accessToken: 'access' });
    });

    it('rechaza las cuentas desactivadas', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ isActive: false }));

      await expect(
        service.login({ email: 'operador@example.com', password: 'correcta' }, CONTEXT),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('revoca todas las sesiones y adelanta tokensValidFrom', async () => {
      const user = makeUser();
      userRepository.findOneOrFail.mockResolvedValue(user);

      await service.changePassword(
        'user-1',
        { currentPassword: 'vieja', newPassword: 'Sup3rS3gura!2026' },
        CONTEXT,
      );

      expect(user.passwordHash).toBe('nuevo-hash');
      // Invalidar los access tokens vivos: si la contraseña se cambia porque estaba
      // comprometida, dejar la sesión del atacante abierta anularía el cambio.
      expect(user.tokensValidFrom.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00Z').getTime(),
      );
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('rechaza el cambio si la contraseña actual no coincide', async () => {
      userRepository.findOneOrFail.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.changePassword(
          'user-1',
          { currentPassword: 'mala', newPassword: 'Sup3rS3gura!2026' },
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('validateAccessPayload', () => {
    it('devuelve el usuario cuando el token es posterior a tokensValidFrom', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      const result = await service.validateAccessPayload({
        sub: 'user-1',
        email: 'operador@example.com',
        role: Role.Customer,
        iat: Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000),
      });

      expect(result).toEqual({
        id: 'user-1',
        email: 'operador@example.com',
        role: Role.Customer,
      });
    });

    it('rechaza un token emitido antes de la invalidación masiva', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ tokensValidFrom: new Date('2026-06-01T00:00:00Z') }),
      );

      await expect(
        service.validateAccessPayload({
          sub: 'user-1',
          email: 'operador@example.com',
          role: Role.Customer,
          iat: Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza a un usuario desactivado aunque el token siga siendo válido', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ isActive: false }));

      await expect(
        service.validateAccessPayload({
          sub: 'user-1',
          email: 'operador@example.com',
          role: Role.Customer,
          iat: Math.floor(Date.now() / 1000),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('toma el rol de la base de datos y no del token', async () => {
      // Un token emitido cuando el usuario era admin no debe seguir dando permisos de
      // admin después de degradarlo.
      userRepository.findOne.mockResolvedValue(makeUser({ role: Role.Driver }));

      const result = await service.validateAccessPayload({
        sub: 'user-1',
        email: 'operador@example.com',
        role: Role.Admin,
        iat: Math.floor(Date.now() / 1000),
      });

      expect(result.role).toBe(Role.Driver);
    });
  });
});
