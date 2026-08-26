import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';

import { AccessTokenPayload, RefreshTokenPayload } from '@/common/types/authenticated-user';
import { parseDurationToSeconds } from '@/common/utils/duration';
import securityConfig from '@/config/security.config';

import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Validez del access token, en segundos. */
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface TokenContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @Inject(securityConfig.KEY) private readonly config: ConfigType<typeof securityConfig>,
  ) {
    this.accessTtlSec = parseDurationToSeconds(config.jwt.accessTtl);
    this.refreshTtlSec = parseDurationToSeconds(config.jwt.refreshTtl);
  }

  get accessTokenTtlSeconds(): number {
    return this.accessTtlSec;
  }

  get refreshTokenTtlSeconds(): number {
    return this.refreshTtlSec;
  }

  /** Emite un par de tokens e inicia una nueva familia de rotación (login). */
  async issueTokenPair(user: User, context: TokenContext): Promise<TokenPair> {
    return this.issueForFamily(user, randomUUID(), context);
  }

  /**
   * Rota un refresh token: emite uno nuevo y revoca el presentado.
   *
   * Si el token presentado ya estaba revocado, se ha reutilizado. Eso solo ocurre si
   * alguien copió el token, así que se revoca la familia entera —tanto la sesión del
   * atacante como la legítima— y el usuario tiene que volver a autenticarse.
   */
  async rotate(
    rawRefreshToken: string,
    resolveUser: (userId: string) => Promise<User | null>,
    context: TokenContext,
  ): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(rawRefreshToken);
    const tokenHash = this.hashToken(rawRefreshToken);

    const stored = await this.refreshTokenRepository.findOne({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Refresh token desconocido.');
    }

    if (stored.revokedAt !== null) {
      this.logger.error(
        `Reutilización de refresh token detectada (familia ${stored.familyId}, ` +
          `usuario ${stored.userId}). Se revoca la familia completa.`,
      );
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'La sesión se ha invalidado por motivos de seguridad. Vuelve a iniciar sesión.',
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('El refresh token ha expirado.');
    }

    const user = await resolveUser(payload.sub);
    if (!user || !user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('La cuenta ya no está activa.');
    }

    const pair = await this.issueForFamily(user, stored.familyId, context);

    stored.revokedAt = new Date();
    await this.refreshTokenRepository.save(stored);

    return pair;
  }

  /** Revoca un refresh token concreto (logout de una sesión). */
  async revokeByRawToken(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('token_hash = :tokenHash AND revoked_at IS NULL', {
        tokenHash: this.hashToken(rawRefreshToken),
      })
      .execute();
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
      .execute();
  }

  /** Cierra todas las sesiones del usuario (cambio de contraseña, cambio de rol, baja). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
  }

  /** Elimina tokens caducados. Pensado para una tarea programada. */
  async purgeExpired(): Promise<number> {
    const result = await this.refreshTokenRepository.delete({
      expiresAt: LessThan(new Date()),
    });
    return result.affected ?? 0;
  }

  async verifyRefreshToken(rawToken: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }
  }

  private async issueForFamily(
    user: User,
    familyId: string,
    context: TokenContext,
  ): Promise<TokenPair> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: user.id, fid: familyId, jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.accessTtlSec,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.jwt.refreshSecret,
        expiresIn: this.refreshTtlSec,
      }),
    ]);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSec,
      refreshExpiresIn: this.refreshTtlSec,
    };
  }

  /**
   * SHA-256 y no Argon2: aquí no hace falta un hash lento. El token es un valor
   * aleatorio de 256+ bits, no una contraseña adivinable, así que no hay nada que
   * ralentizar; lo que se busca es que un volcado de la tabla no contenga credenciales
   * utilizables. Además, el lookup por hash tiene que ser instantáneo.
   */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
