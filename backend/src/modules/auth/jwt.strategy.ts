import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';

import { AccessTokenPayload, AuthenticatedUser } from '@/common/types/authenticated-user';
import securityConfig from '@/config/security.config';

import { AuthService } from './auth.service';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Lee el access token de la cookie httpOnly.
 *
 * La cookie es la vía preferente: guardar el token en `localStorage` lo deja al alcance
 * de cualquier XSS. La cabecera `Authorization` se mantiene como alternativa para
 * clientes que no son navegadores.
 */
const cookieExtractor = (request: Request): string | null => {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly authService: AuthService,
    @Inject(securityConfig.KEY) config: ConfigType<typeof securityConfig>,
  ) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      // Nunca true: aceptar tokens caducados anula por completo el TTL de 15 minutos.
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
      algorithms: ['HS256'],
    };
    super(options);
  }

  /** Passport ya validó firma y expiración; aquí se comprueba el estado actual del usuario. */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    return this.authService.validateAccessPayload(payload);
  }
}
