import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './_transformers';

@Entity('cost_logs')
export class CostLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'agent_id', type: 'uuid', nullable: true }) agentId: string | null;
  @Column({ name: 'content_id', type: 'uuid', nullable: true }) contentId: string | null;
  @Column({ name: 'task_id', type: 'uuid', nullable: true }) taskId: string | null;
  @Column({ type: 'varchar', length: 60 }) provider: string;
  @Column({ name: 'cost_krw', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  costKrw: number;
  @Column({ type: 'varchar', length: 30, nullable: true }) unit: string | null;
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  quantity: number | null;
  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' }) occurredAt: Date;
}
