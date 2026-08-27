import { UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { FindOperator, Repository } from 'typeorm';

import { Role } from '@/common/enums';
import { AccessTokenPayload, RefreshTokenPayload } from '@/common/types/authenticated-user';
import securityConfig from '@/config/security.config';

import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { TokenService } from './token.service';

const ACCESS_SECRET = 'secreto-de-access-para-tests-con-mas-de-32-caracteres';
const REFRESH_SECRET = 'secreto-de-refresh-para-tests-con-mas-de-32-caracteres';
const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

const CONFIG = {
  jwt: {
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTtl: '15m',
    refreshTtl: '7d',
  },
} as unknown as ConfigType<typeof securityConfig>;

const CONTEXT = { ipAddress: '203.0.113.5', userAgent: 'jest' };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'operador@example.com',
    role: Role.Dispatcher,
    isActive: true,
    ...overrides,
  } as User;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Repositorio en memoria.
 *
 * Los métodos de revocación se construyen con `createQueryBuilder`, así que el doble
 * emula el predicado —qué filas selecciona— pero no ejecuta SQL. Lo que se verifica aquí
 * es la decisión del servicio (revocar una fila, una familia o un usuario entero); que
 * ese SQL sea válido en PostgreSQL lo cubren los tests e2e.
 */
function makeRepository() {
  const rows: RefreshToken[] = [];
  let sequence = 0;

  function makeQueryBuilder() {
    let setValues: Partial<RefreshToken> = {};
    let whereSql = '';
    let whereParams: Record<string, unknown> = {};

    const qb = {
      update: () => qb,
      set: (values: Partial<RefreshToken>) => {
        setValues = values;
        return qb;
      },
      where: (sql: string, params: Record<string, unknown>) => {
        whereSql = sql;
        whereParams = params;
        return qb;
      },
      execute: async () => {
        const onlyActive = whereSql.includes('revoked_at IS NULL');

        const matches = rows.filter((row) => {
          if (onlyActive && row.revokedAt !== null) return false;
          if ('tokenHash' in whereParams) return row.tokenHash === whereParams.tokenHash;
          if ('familyId' in whereParams) return row.familyId === whereParams.familyId;
          if ('userId' in whereParams) return row.userId === whereParams.userId;
          return false;
        });

        for (const row of matches) Object.assign(row, setValues);
        return { affected: matches.length };
      },
    };

    return qb;
  }

  return {
    rows,
    create: (entity: Partial<RefreshToken>) => ({ ...entity }) as RefreshToken,
    save: jest.fn(async (entity: RefreshToken) => {
      if (!entity.id) {
        entity.id = `token-${++sequence}`;
        entity.revokedAt = entity.revokedAt ?? null;
        rows.push(entity);
      }
      return entity;
    }),
    findOne: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
      return rows.find((row) => row.tokenHash === where.tokenHash) ?? null;
    }),
    delete: jest.fn(async ({ expiresAt }: { expiresAt: FindOperator<Date> }) => {
      const cutoff = expiresAt.value;
      const survivors = rows.filter((row) => row.expiresAt.getTime() >= cutoff.getTime());
      const affected = rows.length - survivors.length;
      rows.splice(0, rows.length, ...survivors);
      return { affected };
    }),
    createQueryBuilder: jest.fn(() => makeQueryBuilder()),
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let repository: ReturnType<typeof makeRepository>;
  let jwtService: JwtService;

  // El usuario se resuelve por callback para que `TokenService` no dependa del
  // repositorio de usuarios; en los tests se sustituye por el doble que interese.
  const resolveActiveUser = async () => makeUser();

  beforeEach(() => {
    repository = makeRepository();
    jwtService = new JwtService({});

    service = new TokenService(
      jwtService,
      repository as unknown as Repository<RefreshToken>,
      CONFIG,
    );
  });

  describe('issueTokenPair', () => {
    it('emite un access token verificable con el secreto de access', async () => {
      const user = makeUser();

      const pair = await service.issueTokenPair(user, CONTEXT);
      const payload = await jwtService.verifyAsync<AccessTokenPayload>(pair.accessToken, {
        secret: ACCESS_SECRET,
      });

      expect(payload.sub).toBe(user.id);
      expect(payload.email).toBe(user.email);
      expect(payload.role).toBe(Role.Dispatcher);
    });

    it('emite un refresh token con el identificador de familia y un jti único', async () => {
      const first = await service.issueTokenPair(makeUser(), CONTEXT);
      const second = await service.issueTokenPair(makeUser(), CONTEXT);

      const a = await jwtService.verifyAsync<RefreshTokenPayload>(first.refreshToken, {
        secret: REFRESH_SECRET,
      });
      const b = await jwtService.verifyAsync<RefreshTokenPayload>(second.refreshToken, {
        secret: REFRESH_SECRET,
      });

      expect(a.jti).not.toBe(b.jti);
      // Cada login abre una sesión independiente: revocar una no debe tocar la otra.
      expect(a.fid).not.toBe(b.fid);
    });

    it('persiste el hash SHA-256 y nunca el token en claro', async () => {
      const pair = await service.issueTokenPair(makeUser(), CONTEXT);

      expect(repository.rows).toHaveLength(1);
      expect(repository.rows[0].tokenHash).toBe(sha256(pair.refreshToken));
      expect(JSON.stringify(repository.rows)).not.toContain(pair.refreshToken);
    });

    it('informa los TTL configurados en segundos', async () => {
      const pair = await service.issueTokenPair(makeUser(), CONTEXT);

      expect(pair.expiresIn).toBe(ACCESS_TTL_SEC);
      expect(pair.refreshExpiresIn).toBe(REFRESH_TTL_SEC);
      expect(service.accessTokenTtlSeconds).toBe(ACCESS_TTL_SEC);
      expect(service.refreshTokenTtlSeconds).toBe(REFRESH_TTL_SEC);
    });

    it('trunca el user-agent al ancho de la columna', async () => {
      await service.issueTokenPair(makeUser(), { ipAddress: null, userAgent: 'x'.repeat(400) });

      expect(repository.rows[0].userAgent).toHaveLength(255);
    });

    it('acepta un contexto sin IP ni user-agent', async () => {
      await service.issueTokenPair(makeUser(), {});

      expect(repository.rows[0].ipAddress).toBeNull();
      expect(repository.rows[0].userAgent).toBeNull();
    });
  });

  describe('rotate', () => {
    it('emite un par nuevo dentro de la misma familia', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);
      const familyId = repository.rows[0].familyId;

      const rotated = await service.rotate(original.refreshToken, resolveActiveUser, CONTEXT);

      expect(rotated.refreshToken).not.toBe(original.refreshToken);
      expect(repository.rows).toHaveLength(2);
      expect(repository.rows[1].familyId).toBe(familyId);
    });

    it('revoca el token presentado', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);

      await service.rotate(original.refreshToken, resolveActiveUser, CONTEXT);

      expect(repository.rows[0].revokedAt).toBeInstanceOf(Date);
      expect(repository.rows[1].revokedAt).toBeNull();
    });

    it('revoca la familia entera si se reutiliza un token ya rotado', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);
      const rotated = await service.rotate(original.refreshToken, resolveActiveUser, CONTEXT);

      // El atacante presenta el token viejo: el legítimo ya lo había canjeado.
      await expect(
        service.rotate(original.refreshToken, resolveActiveUser, CONTEXT),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // La sesión viva del usuario legítimo también cae: no se puede distinguir
      // cuál de las dos es la copiada.
      const stillActive = repository.rows.filter((row) => row.revokedAt === null);
      expect(stillActive).toHaveLength(0);
      expect(
        repository.rows.find((row) => row.tokenHash === sha256(rotated.refreshToken))?.revokedAt,
      ).toBeInstanceOf(Date);
    });

    it('rechaza un refresh token que no está en la base de datos', async () => {
      const user = makeUser();
      // Firmado con el secreto correcto pero nunca emitido por el servicio.
      const forged = await jwtService.signAsync(
        { sub: user.id, fid: 'family-x', jti: 'jti-x' },
        { secret: REFRESH_SECRET, expiresIn: REFRESH_TTL_SEC },
      );

      await expect(service.rotate(forged, resolveActiveUser, CONTEXT)).rejects.toThrow(
        'Refresh token desconocido.',
      );
    });

    it('rechaza un token cuya fila ya ha caducado', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);
      repository.rows[0].expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.rotate(original.refreshToken, resolveActiveUser, CONTEXT),
      ).rejects.toThrow('El refresh token ha expirado.');
    });

    it('rechaza una firma inválida sin consultar la base de datos', async () => {
      await expect(service.rotate('no-es-un-jwt', resolveActiveUser, CONTEXT)).rejects.toThrow(
        'Refresh token inválido.',
      );

      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('revoca la familia si la cuenta se ha desactivado', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);

      await expect(
        service.rotate(original.refreshToken, async () => makeUser({ isActive: false }), CONTEXT),
      ).rejects.toThrow('La cuenta ya no está activa.');

      expect(repository.rows[0].revokedAt).toBeInstanceOf(Date);
    });

    it('revoca la familia si la cuenta ya no existe', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);

      await expect(
        service.rotate(original.refreshToken, async () => null, CONTEXT),
      ).rejects.toThrow('La cuenta ya no está activa.');

      expect(repository.rows[0].revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('verifyRefreshToken', () => {
    it('rechaza un token firmado con el secreto de access', async () => {
      // Si ambos secretos fueran intercambiables, un access token robado valdría como
      // refresh y la rotación dejaría de significar nada. Por eso el arranque exige
      // que sean distintos.
      const accessToken = await jwtService.signAsync(
        { sub: 'user-1', email: 'a@b.com', role: Role.Customer },
        { secret: ACCESS_SECRET, expiresIn: ACCESS_TTL_SEC },
      );

      await expect(service.verifyRefreshToken(accessToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('acepta un refresh token recién emitido', async () => {
      const pair = await service.issueTokenPair(makeUser(), CONTEXT);

      await expect(service.verifyRefreshToken(pair.refreshToken)).resolves.toMatchObject({
        sub: 'user-1',
      });
    });
  });

  describe('revocación', () => {
    it('revokeByRawToken revoca solo esa sesión, no la familia', async () => {
      const first = await service.issueTokenPair(makeUser(), CONTEXT);
      await service.issueTokenPair(makeUser(), CONTEXT);

      await service.revokeByRawToken(first.refreshToken);

      expect(repository.rows[0].revokedAt).toBeInstanceOf(Date);
      expect(repository.rows[1].revokedAt).toBeNull();
    });

    it('revokeAllForUser no toca los tokens de otros usuarios', async () => {
      await service.issueTokenPair(makeUser(), CONTEXT);
      await service.issueTokenPair(makeUser({ id: 'user-2' }), CONTEXT);

      await service.revokeAllForUser('user-1');

      expect(repository.rows[0].revokedAt).toBeInstanceOf(Date);
      expect(repository.rows[1].revokedAt).toBeNull();
    });

    it('revokeFamily alcanza todas las rotaciones de la misma sesión', async () => {
      const original = await service.issueTokenPair(makeUser(), CONTEXT);
      await service.rotate(original.refreshToken, resolveActiveUser, CONTEXT);
      const familyId = repository.rows[0].familyId;

      await service.revokeFamily(familyId);

      expect(repository.rows.every((row) => row.revokedAt !== null)).toBe(true);
    });
  });

  describe('purgeExpired', () => {
    it('elimina las filas caducadas y conserva las vigentes', async () => {
      await service.issueTokenPair(makeUser(), CONTEXT);
      await service.issueTokenPair(makeUser(), CONTEXT);
      repository.rows[0].expiresAt = new Date(Date.now() - 60_000);

      const removed = await service.purgeExpired();

      expect(removed).toBe(1);
      expect(repository.rows).toHaveLength(1);
    });

    it('devuelve 0 cuando no hay nada que purgar', async () => {
      await service.issueTokenPair(makeUser(), CONTEXT);

      await expect(service.purgeExpired()).resolves.toBe(0);
    });
  });
});
