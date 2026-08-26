import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { CurrentUser, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { UserProfileDto } from '@/modules/auth/dto/auth.dto';

import { PaginatedUsersDto, UsersService } from './users.service';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Gestión de usuarios. Reservada a ADMIN (RF-017). */
@ApiTags('Users')
@ApiBearerAuth('JWT')
@Roles(Role.Admin)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista usuarios paginados' })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<PaginatedUsersDto> {
    return this.usersService.findAll({ page, limit, search });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene un usuario por su id' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserProfileDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualiza el rol o el estado de un usuario',
    description:
      'Cambiar el rol o desactivar la cuenta revoca inmediatamente las sesiones activas ' +
      'del usuario afectado.',
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithUser,
  ): Promise<UserProfileDto> {
    return this.usersService.update(id, dto, actor, request);
  }
}
