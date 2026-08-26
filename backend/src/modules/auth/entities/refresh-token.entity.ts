import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';

/**
 * Refresh token persistido para poder revocarlo. Un JWT puro no se puede invalidar
 * antes de que expire; con 7 días de vida eso es inaceptable si se filtra.
 *
 * Se guarda el hash SHA-256 del token, no el token: si alguien lee la tabla no obtiene
 * credenciales usables.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_refresh_tokens_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('idx_refresh_tokens_hash', { unique: true })
  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash: string;

  /** Agrupa la cadena de rotaciones de una misma sesión. */
  @Index('idx_refresh_tokens_family')
  @Column({ type: 'uuid', name: 'family_id' })
  familyId: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  /** Token que sustituyó a éste al rotar. Permite detectar reutilización. */
  @Column({ type: 'uuid', name: 'replaced_by_id', nullable: true })
  replacedById: string | null;

  @Column({ type: 'inet', name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  get isActive(): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > Date.now();
  }
}
