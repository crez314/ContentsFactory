import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 60 }) action: string;
  @Column({ name: 'target_type', type: 'varchar', length: 40 }) targetType: string;
  @Column({ name: 'target_id', type: 'uuid', nullable: true }) targetId: string | null;
  @Column({ type: 'jsonb', nullable: true }) before: unknown;
  @Column({ type: 'jsonb', nullable: true }) after: unknown;
  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
