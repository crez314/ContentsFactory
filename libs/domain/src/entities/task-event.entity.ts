import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { TaskState } from '../types/enums';

@Entity('task_events')
export class TaskEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'task_id', type: 'uuid' }) taskId: string;
  @Column({ name: 'from_state', type: 'varchar', length: 20, nullable: true }) fromState: TaskState | null;
  @Column({ name: 'to_state', type: 'varchar', length: 20 }) toState: TaskState;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ type: 'jsonb', nullable: true }) meta: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
