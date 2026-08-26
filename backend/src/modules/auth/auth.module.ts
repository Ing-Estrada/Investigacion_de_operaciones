import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import securityConfig from '@/config/security.config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    ConfigModule.forFeature(securityConfig),
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Los secretos se pasan explícitamente en cada firma/verificación porque access y
    // refresh usan claves distintas; registrar uno global aquí invitaría a olvidarlo.
    JwtModule.register({ signOptions: { algorithm: 'HS256' } }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy],
  exports: [AuthService, TokenService, PasswordService, TypeOrmModule],
})
export class AuthModule {}
