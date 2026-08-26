import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CookieOptions, Response } from 'express';

import { CurrentUser, Public, RateLimit } from '@/common/decorators';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import securityConfig from '@/config/security.config';
import { AuditService } from '@/modules/audit/audit.service';

import { AuthResult, AuthService } from './auth.service';
import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UserProfileDto,
} from './dto/auth.dto';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './jwt.strategy';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    @Inject(securityConfig.KEY) private readonly config: ConfigType<typeof securityConfig>,
  ) {}

  @Public()
  // 3 registros por hora y por IP: suficiente para un usuario legítimo que se equivoca,
  // inviable para crear cuentas en masa.
  @RateLimit({ limit: 3, windowSec: 3600, byIpOnly: true })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra una cuenta nueva' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'El email ya está en uso' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto, this.context(request));
    return this.respondWithCookies(result, response);
  }

  @Public()
  // 5 intentos por minuto y por IP (RNF-006). El bloqueo por cuenta tras 5 fallos
  // consecutivos actúa en paralelo y cubre el ataque distribuido desde varias IP.
  @RateLimit({ limit: 5, windowSec: 60, byIpOnly: true })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesión y emite el par de tokens' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 403, description: 'Cuenta bloqueada temporalmente' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto, this.context(request));
    return this.respondWithCookies(result, response);
  }

  @Public()
  @RateLimit({ limit: 20, windowSec: 60, byIpOnly: true })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rota el refresh token y emite un access token nuevo',
    description:
      'Lee el refresh token de la cookie httpOnly. Reutilizar un token ya rotado revoca ' +
      'la familia completa de sesiones.',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async refresh(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { refreshToken?: string },
  ): Promise<AuthResponseDto> {
    const token = this.readRefreshToken(request, body?.refreshToken);
    if (!token) {
      throw new UnauthorizedException('No se ha aportado un refresh token.');
    }

    const result = await this.authService.refresh(token, this.context(request));
    return this.respondWithCookies(result, response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Cierra la sesión actual y revoca su refresh token' })
  async logout(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const token = this.readRefreshToken(request);
    await this.authService.logout(token, user, this.context(request));
    this.clearAuthCookies(response);
  }

  @Get('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Devuelve el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async me(@CurrentUser('id') userId: string): Promise<UserProfileDto> {
    return this.authService.getProfile(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 5, windowSec: 3600 })
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Cambia la contraseña',
    description: 'Revoca todas las sesiones activas, incluida la que hace la petición.',
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.changePassword(userId, dto, this.context(request));
    this.clearAuthCookies(response);
  }

  // --- Utilidades internas ---------------------------------------------------

  private context(request: RequestWithUser) {
    return {
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    };
  }

  private readRefreshToken(request: RequestWithUser, fromBody?: string): string | undefined {
    const cookies = (request as RequestWithUser & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_TOKEN_COOKIE] ?? fromBody;
  }

  /**
   * Emite los tokens como cookies httpOnly y devuelve el access token también en el
   * cuerpo, para los clientes que no gestionan cookies.
   */
  private respondWithCookies(result: AuthResult, response: Response): AuthResponseDto {
    response.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, this.cookieOptions(result.expiresIn));

    response.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, {
      ...this.cookieOptions(result.refreshExpiresIn),
      // El refresh token solo viaja hacia los endpoints que lo necesitan; así no se
      // adjunta a cada petición de la API y su superficie de exposición es mínima.
      path: '/api/v1/auth',
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  private cookieOptions(maxAgeSec: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: this.config.cookie.sameSite,
      domain: this.config.cookie.domain,
      maxAge: maxAgeSec * 1000,
      path: '/',
    };
  }

  private clearAuthCookies(response: Response): void {
    const base = {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: this.config.cookie.sameSite,
      domain: this.config.cookie.domain,
    } as const;

    response.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, path: '/' });
    response.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: '/api/v1/auth' });
  }
}
