import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { SceneSourceType, SceneStatus } from '../types/enums';
import { Content } from './content.entity';

@Entity('scenes')
export class Scene {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  @ManyToOne(() => Content, (c) => c.scenes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' }) content?: Content;
  @Column({ type: 'int' }) seq: number;
  @Column({ name: 'duration_ms', type: 'int' }) durationMs: number;
  @Column({ name: 'source_type', type: 'varchar', length: 20 }) sourceType: SceneSourceType;
  @Column({ name: 'source_asset_id', type: 'uuid', nullable: true }) sourceAssetId: string | null;
  @Column({ type: 'text', nullable: true }) prompt: string | null;
  @Column({ type: 'text', nullable: true }) subtitle: string | null;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: SceneStatus;
  @Column({ name: 'retry_count', type: 'smallint', default: 0 }) retryCount: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
