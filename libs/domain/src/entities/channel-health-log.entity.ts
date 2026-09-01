import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { ChannelHealthState } from '../types/enums';
import { numericTransformer } from './_transformers';

/**
 * §4.9 일일 채널 관측 기록.
 * V1 은 도달률 기준선을 만들 표본이 없어 자동 조정을 하지 않지만,
 * V2 시점에 기준선을 즉시 계산할 수 있도록 V1 부터 적재한다.
 */
@Entity('channel_health_logs')
export class ChannelHealthLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId: string;
  @Column({ name: 'observed_on', type: 'date' }) observedOn: string;
  @Column({ name: 'posted_count', type: 'int', default: 0 }) postedCount: number;
  @Column({ name: 'policy_removals', type: 'int', default: 0 }) policyRemovals: number;
  @Column({ name: 'daily_cap', type: 'int', default: 0 }) dailyCap: number;
  /** V2 — Analytics 수집 이후 채움 */
  @Column({ name: 'reach_rate', type: 'numeric', precision: 10, scale: 4, nullable: true, transformer: numericTransformer })
  reachRate: number | null;
  @Column({ name: 'reach_zscore', type: 'numeric', precision: 10, scale: 4, nullable: true, transformer: numericTransformer })
  reachZscore: number | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) signals: Record<string, unknown>;
  @Column({ name: 'state_after', type: 'varchar', length: 16 }) stateAfter: ChannelHealthState;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
