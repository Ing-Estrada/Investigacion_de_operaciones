import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { AuditAction } from '@/common/enums';

/**
 * Registro de auditoría (RF-018).
 *
 * `userId` es nullable y SIN clave foránea: un log de auditoría debe sobrevivir al
 * borrado del usuario al que apunta, y `ON DELETE SET NULL` destruiría la única prueba
 * de quién hizo qué. Se conserva además `userEmail` como copia desnormalizada por si
 * la fila de `users` desaparece.
 *
 * Nunca se escriben aquí contraseñas, tokens ni claves de API.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_audit_logs_user_id')
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_email', nullable: true })
  userEmail: string | null;

  @Index('idx_audit_logs_action')
  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Index('idx_audit_logs_entity')
  @Column({ type: 'varchar', length: 50, name: 'entity_type' })
  entityType: string;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', name: 'old_values', nullable: true })
  oldValues: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'new_values', nullable: true })
  newValues: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'inet', name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @Index('idx_audit_logs_created_at')
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
