import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { ApprovalDecision } from '../types/enums';
import { User } from './user.entity';

@Entity('approvals')
export class Approval {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  /** NULL 이면 자동 승인 */
  @Column({ name: 'decided_by', type: 'uuid', nullable: true }) decidedBy: string | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'decided_by' }) decider?: User;
  @Column({ type: 'varchar', length: 12 }) decision: ApprovalDecision;
  @Column({ type: 'boolean', default: false }) auto: boolean;
  @Column({ name: 'level_at', type: 'smallint' }) levelAt: number;
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
