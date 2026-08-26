import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditAction, Role } from '@/common/enums';
import { AccountLockedException } from '@/common/exceptions/domain.exceptions';
import { AccessTokenPayload, AuthenticatedUser } from '@/common/types/authenticated-user';
import { AuditService } from '@/modules/audit/audit.service';

import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UserProfileDto,
} from './dto/auth.dto';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { TokenContext, TokenPair, TokenService } from './token.service';

/** Intentos fallidos consecutivos antes de bloquear la cuenta (RNF-006). */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

export interface AuthResult extends AuthResponseDto {
  refreshToken: string;
  refreshExpiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto, context: TokenContext): Promise<AuthResult> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      await this.auditService.record({
        action: AuditAction.Register,
        entityType: 'user',
        userEmail: dto.email,
        success: false,
        reason: 'El email ya está registrado',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      // Se responde con el mismo error genérico que vería cualquiera; el detalle de
      // que "ya existe" es inevitable en un registro, pero no se filtra nada más.
      throw new ConflictException('No se pudo completar el registro con esos datos.');
    }

    const user = this.userRepository.create({
      email: dto.email,
      passwordHash: await this.passwordService.hash(dto.password),
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: Role.Customer,
      tokensValidFrom: new Date(),
    });

    const saved = await this.userRepository.save(user);

    await this.auditService.record({
      action: AuditAction.Register,
      entityType: 'user',
      entityId: saved.id,
      userId: saved.id,
      userEmail: saved.email,
      newValues: { email: saved.email, role: saved.role },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const tokens = await this.tokenService.issueTokenPair(saved, context);
    return this.buildAuthResult(saved, tokens);
  }

  async login(dto: LoginDto, context: TokenContext): Promise<AuthResult> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });

    // Usuario inexistente: se consume el mismo tiempo de CPU que en una verificación
    // real para que el atacante no pueda distinguir ambos casos por latencia.
    if (!user) {
      await this.passwordService.verifyDummy(dto.password);
      await this.recordFailedLogin(dto.email, null, 'Email no registrado', context);
      throw new UnauthorizedException('Email o contraseña incorrectos.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.recordFailedLogin(user.email, user.id, 'Cuenta bloqueada', context);
      throw new AccountLockedException(user.lockedUntil);
    }

    const passwordMatches = await this.passwordService.verify(user.passwordHash, dto.password);

    if (!passwordMatches) {
      await this.registerFailedAttempt(user);
      await this.recordFailedLogin(user.email, user.id, 'Contraseña incorrecta', context);
      throw new UnauthorizedException('Email o contraseña incorrectos.');
    }

    if (!user.isActive) {
      await this.recordFailedLogin(user.email, user.id, 'Cuenta desactivada', context);
      throw new UnauthorizedException('La cuenta está desactivada.');
    }

    // Login correcto: se limpia el contador de fallos.
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    await this.auditService.record({
      action: AuditAction.Login,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const tokens = await this.tokenService.issueTokenPair(user, context);
    return this.buildAuthResult(user, tokens);
  }

  async refresh(rawRefreshToken: string, context: TokenContext): Promise<AuthResult> {
    const tokens = await this.tokenService.rotate(
      rawRefreshToken,
      (userId) => this.userRepository.findOne({ where: { id: userId } }),
      context,
    );

    const payload = await this.tokenService.verifyRefreshToken(tokens.refreshToken);
    const user = await this.userRepository.findOneOrFail({ where: { id: payload.sub } });

    await this.auditService.record({
      action: AuditAction.TokenRefresh,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.buildAuthResult(user, tokens);
  }

  async logout(
    rawRefreshToken: string | undefined,
    user: AuthenticatedUser | undefined,
    context: TokenContext,
  ): Promise<void> {
    if (rawRefreshToken) {
      await this.tokenService.revokeByRawToken(rawRefreshToken);
    }

    if (user) {
      await this.auditService.record({
        action: AuditAction.Logout,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        userEmail: user.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context: TokenContext,
  ): Promise<void> {
    const user = await this.userRepository.findOneOrFail({ where: { id: userId } });

    const matches = await this.passwordService.verify(user.passwordHash, dto.currentPassword);
    if (!matches) {
      await this.auditService.record({
        action: AuditAction.PasswordChange,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        userEmail: user.email,
        success: false,
        reason: 'La contraseña actual no coincide',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    user.passwordHash = await this.passwordService.hash(dto.newPassword);
    // Invalida los access tokens ya emitidos sin esperar a que caduquen.
    user.tokensValidFrom = new Date();
    await this.userRepository.save(user);

    // Y cierra el resto de sesiones: si la contraseña se cambia porque estaba
    // comprometida, dejar viva la sesión del atacante haría el cambio inútil.
    await this.tokenService.revokeAllForUser(user.id);

    await this.auditService.record({
      action: AuditAction.PasswordChange,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  /**
   * Valida el payload de un access token ya verificado criptográficamente.
   * Comprueba además el estado actual en base de datos: un token con firma válida
   * no debe servir si la cuenta se desactivó o si se revocaron los tokens.
   */
  async validateAccessPayload(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true, tokensValidFrom: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('La cuenta no está disponible.');
    }

    // `iat` viene en segundos; se compara con el mismo truncamiento para evitar que un
    // token emitido en el mismo segundo del cambio se rechace por milisegundos.
    const issuedAtSec = payload.iat ?? 0;
    const validFromSec = Math.floor(user.tokensValidFrom.getTime() / 1000);
    if (issuedAtSec < validFromSec) {
      throw new UnauthorizedException('La sesión ha sido invalidada. Vuelve a iniciar sesión.');
    }

    // El rol se toma de la BD, no del token: una degradación de privilegios debe surtir
    // efecto de inmediato, no al expirar el access token.
    return { id: user.id, email: user.email, role: user.role };
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.userRepository.findOneOrFail({ where: { id: userId } });
    return this.toProfile(user);
  }

  private async registerFailedAttempt(user: User): Promise<void> {
    user.failedLoginAttempts += 1;

    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000);
      user.failedLoginAttempts = 0;
      this.logger.warn(
        `Cuenta ${user.id} bloqueada ${LOCK_DURATION_MINUTES} min tras ` +
          `${MAX_FAILED_ATTEMPTS} intentos fallidos.`,
      );
    }

    await this.userRepository.save(user);
  }

  private async recordFailedLogin(
    email: string,
    userId: string | null,
    reason: string,
    context: TokenContext,
  ): Promise<void> {
    await this.auditService.record({
      action: AuditAction.LoginFailed,
      entityType: 'user',
      entityId: userId,
      userId,
      userEmail: email,
      success: false,
      reason,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private buildAuthResult(user: User, tokens: TokenPair): AuthResult {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      refreshExpiresIn: tokens.refreshExpiresIn,
      user: this.toProfile(user),
    };
  }

  private toProfile(user: User): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
    };
  }
}
