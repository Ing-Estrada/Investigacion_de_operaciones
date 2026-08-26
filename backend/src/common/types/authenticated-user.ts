import { Request } from 'express';

import { Role } from '@/common/enums';

/** Payload del access token, ya verificado. Es lo único que el resto de la app ve del usuario. */
export interface AuthenticatedUser {
  /** `sub` del JWT: el UUID del usuario. */
  id: string;
  email: string;
  role: Role;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/** Claims que emitimos en el access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  /** Emitido en segundos Unix por `@nestjs/jwt`. */
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Identificador de la familia de rotación, para detectar reutilización. */
  fid: string;
  jti: string;
  iat?: number;
  exp?: number;
}
