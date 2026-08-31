import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { TaskKind, TaskState } from '../types/enums';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40 }) kind: TaskKind;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId: string | null;
  @Column({ name: 'content_id', type: 'uuid', nullable: true }) contentId: string | null;
  @Column({ name: 'scene_id', type: 'uuid', nullable: true }) sceneId: string | null;
  @Column({ name: 'agent_id', type: 'uuid', nullable: true }) agentId: string | null;
  /** §3.1 0~4, 낮을수록 먼저 처리된다. */
  @Column({ type: 'smallint', default: 3 }) priority: number;
  @Column({ type: 'varchar', length: 20, default: 'QUEUED' }) state: TaskState;
  @Column({ name: 'retry_count', type: 'smallint', default: 0 }) retryCount: number;
  @Column({ name: 'max_retry', type: 'smallint', default: 3 }) maxRetry: number;
  /** §3.5 {kind}:{contentId|orderId}:{sceneId?}:{attempt} */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, unique: true }) idempotencyKey: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) payload: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) result: unknown;
  @Column({ type: 'jsonb', nullable: true }) error: unknown;
  @CreateDateColumn({ name: 'queued_at', type: 'timestamptz' }) queuedAt: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true }) finishedAt: Date | null;
  @Column({ name: 'sla_deadline', type: 'timestamptz', nullable: true }) slaDeadline: Date | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
