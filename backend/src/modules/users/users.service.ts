import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { AuditAction, Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { AuditService } from '@/modules/audit/audit.service';
import { UserProfileDto } from '@/modules/auth/dto/auth.dto';
import { User } from '@/modules/auth/entities/user.entity';
import { TokenService } from '@/modules/auth/token.service';

import { UpdateUserDto } from './users.controller';

export class PaginatedUsersDto {
  @ApiProperty({ type: [UserProfileDto] })
  items: UserProfileDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly auditService: AuditService,
    private readonly tokenService: TokenService,
  ) {}

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
  }): Promise<PaginatedUsersDto> {
    const page = Math.max(1, params.page);
    // Techo duro: sin él, `?limit=1000000` es un DoS trivial contra la base de datos.
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit));

    const where = params.search
      ? [
          { email: ILike(`%${params.search}%`) },
          { firstName: ILike(`%${params.search}%`) },
          { lastName: ILike(`%${params.search}%`) },
        ]
      : {};

    const [users, total] = await this.userRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items: users.map(toProfile), total, page, limit };
  }

  async findOne(id: string): Promise<UserProfileDto> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return toProfile(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<UserProfileDto> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    // Un administrador no puede quitarse a sí mismo el rol ni desactivarse: es la forma
    // más habitual de quedarse sin ningún admin operativo en el sistema.
    if (user.id === actor.id) {
      if (dto.role && dto.role !== Role.Admin) {
        throw new BadRequestException('No puedes retirarte a ti mismo el rol de administrador.');
      }
      if (dto.isActive === false) {
        throw new BadRequestException('No puedes desactivar tu propia cuenta.');
      }
    }

    if (dto.role && dto.role !== Role.Admin && user.role === Role.Admin) {
      const remainingAdmins = await this.userRepository.count({
        where: { role: Role.Admin, isActive: true },
      });
      if (remainingAdmins <= 1) {
        throw new BadRequestException('Debe quedar al menos un administrador activo.');
      }
    }

    const oldValues = { role: user.role, isActive: user.isActive };
    const roleChanged = dto.role !== undefined && dto.role !== user.role;
    const deactivated = dto.isActive === false && user.isActive;

    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    // Un cambio de privilegios tiene que surtir efecto ya, no cuando caduque el token.
    if (roleChanged || deactivated) {
      user.tokensValidFrom = new Date();
    }

    const saved = await this.userRepository.save(user);

    if (roleChanged || deactivated) {
      await this.tokenService.revokeAllForUser(saved.id);
    }

    await this.auditService.record({
      action: roleChanged ? AuditAction.RoleChange : AuditAction.Update,
      entityType: 'user',
      entityId: saved.id,
      userId: actor.id,
      userEmail: actor.email,
      oldValues,
      newValues: { role: saved.role, isActive: saved.isActive },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return toProfile(saved);
  }
}

function toProfile(user: User): UserProfileDto {
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
