import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ChannelStatus, Platform } from '../types/enums';
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
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
