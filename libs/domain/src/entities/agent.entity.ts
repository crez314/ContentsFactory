import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { AgentKind, AgentLifecycle } from '../types/enums';
import { numericTransformer } from './_transformers';

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 30 }) kind: AgentKind;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) profile: Record<string, unknown>;
  /** §4.7 승인 레벨 0~3. V1 은 운영자 수동 설정만 지원한다. */
  @Column({ name: 'approval_level', type: 'smallint', default: 0 }) approvalLevel: number;
  @Column({ name: 'daily_budget', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  dailyBudget: number;
  @Column({ name: 'monthly_budget', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  monthlyBudget: number;
  @Column({ type: 'varchar', length: 20, default: 'CREATED' }) lifecycle: AgentLifecycle;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
