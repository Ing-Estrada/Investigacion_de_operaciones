import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Role } from '@/common/enums';
import { Vehicle } from '@/modules/vehicles/entities/vehicle.entity';

@Entity('users')
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'operador@example.com' })
  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  /**
   * Hash Argon2id — nunca la contraseña. `@Exclude` impide que se serialice aunque
   * alguien devuelva la entidad completa por error desde un controlador.
   */
  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  @ApiProperty({ enum: Role })
  @Column({ type: 'enum', enum: Role, default: Role.Customer })
  role: Role;

  @ApiProperty()
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Contador de intentos fallidos consecutivos. Se reinicia en cada login correcto y
   * bloquea la cuenta al superar el umbral (RNF-006).
   */
  @Exclude()
  @Column({ type: 'smallint', name: 'failed_login_attempts', default: 0 })
  failedLoginAttempts: number;

  @Exclude()
  @Column({ type: 'timestamptz', name: 'locked_until', nullable: true })
  lockedUntil: Date | null;

  @Exclude()
  @Column({ type: 'timestamptz', name: 'last_login_at', nullable: true })
  lastLoginAt: Date | null;

  /**
   * Invalida en bloque todos los tokens emitidos antes de este instante. Se actualiza
   * al cambiar la contraseña o el rol, de modo que un access token vivo deje de servir
   * sin esperar a que expire.
   */
  @Exclude()
  @Column({ type: 'timestamptz', name: 'tokens_valid_from', default: () => 'CURRENT_TIMESTAMP' })
  tokensValidFrom: Date;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.user)
  vehicles: Vehicle[];

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
