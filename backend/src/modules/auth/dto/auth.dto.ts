import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Role } from '@/common/enums';

/**
 * Política de contraseñas: 12+ caracteres con minúscula, mayúscula, dígito y símbolo.
 * El límite superior de 128 no es cosmético — Argon2 hashea la entrada completa, y sin
 * tope un POST de 10 MB en el campo `password` es un DoS de CPU gratis.
 */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

const PASSWORD_MESSAGE =
  'La contraseña debe tener entre 12 y 128 caracteres e incluir minúscula, mayúscula, dígito y carácter especial.';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @ApiProperty({ example: 'operador@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Sup3rS3gura!2026', minLength: 12 })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MaxLength(128)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'operador@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Sup3rS3gura!2026', minLength: 12 })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128, { message: PASSWORD_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({ example: 'Ana' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Torres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;
}

export class RefreshTokenDto {
  /**
   * Opcional: el flujo normal lee el refresh token de la cookie httpOnly. Este campo
   * existe para clientes no-navegador (app móvil, integraciones máquina a máquina).
   */
  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(1024)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128, { message: PASSWORD_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

// --- Respuestas -------------------------------------------------------------

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ required: false, nullable: true })
  lastLoginAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Access token JWT. También se emite como cookie httpOnly.' })
  accessToken: string;

  @ApiProperty({ description: 'Segundos de validez del access token.' })
  expiresIn: number;

  @ApiProperty({ type: UserProfileDto })
  user: UserProfileDto;
}
