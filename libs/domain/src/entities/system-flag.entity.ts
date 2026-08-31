import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_flags')
export class SystemFlag {
  @PrimaryColumn({ type: 'varchar', length: 60 }) key: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) value: Record<string, unknown>;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
