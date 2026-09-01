import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ChannelHealthState, ChannelStatus, Platform } from '../types/enums';
import type { ChannelSpec } from '../types/json-shapes';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 20 }) platform: Platform;
  @Column({ type: 'varchar', length: 120 }) handle: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) segment: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) region: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) spec: ChannelSpec;
  /** Secrets Manager 경로. 자격증명 원문은 DB 에 저장하지 않는다 (§9.2). */
  @Column({ name: 'credential_ref', type: 'varchar', length: 200, nullable: true }) credentialRef: string | null;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: ChannelStatus;

  // ─────────── §4.9 Channel Health
  /** 플랫폼 제재 위험에 대한 자동 판정. status(운영자 스위치)와 독립이다. */
  @Column({ name: 'health_state', type: 'varchar', length: 16, default: 'ACTIVE' }) healthState: ChannelHealthState;
  /** 하루 안전 게시 건수 */
  @Column({ name: 'daily_cap', type: 'int', default: 3 }) dailyCap: number;
  /** 게시 최소 간격(분) */
  @Column({ name: 'min_interval_min', type: 'int', default: 180 }) minIntervalMin: number;
  /** 관측으로 확인된 안전 상한. V2 AIMD 가 이 값을 기준으로 올린다. */
  @Column({ name: 'observed_safe_max', type: 'int', default: 3 }) observedSafeMax: number;
  @Column({ name: 'quarantined_at', type: 'timestamptz', nullable: true }) quarantinedAt: Date | null;
  @Column({ name: 'quarantine_reason', type: 'text', nullable: true }) quarantineReason: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
