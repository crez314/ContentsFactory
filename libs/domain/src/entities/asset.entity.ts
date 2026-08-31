import {
  Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { AssetStatus, MediaType, QualityGrade, TaggingStatus } from '../types/enums';
import type { AssetAttributes } from '../types/json-shapes';
import { Artist } from './artist.entity';
import { AssetLicense } from './asset-license.entity';
import { bigintTransformer } from './_transformers';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'artist_id', type: 'uuid' }) artistId: string;
  @ManyToOne(() => Artist) @JoinColumn({ name: 'artist_id' }) artist?: Artist;

  @Column({ name: 'media_type', type: 'varchar', length: 20 }) mediaType: MediaType;
  @Column({ name: 'storage_key', type: 'text' }) storageKey: string;
  @Column({ name: 'file_size', type: 'bigint', transformer: bigintTransformer }) fileSize: number;
  @Column({ name: 'mime_type', type: 'varchar', length: 80 }) mimeType: string;
  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @Column({ name: 'shot_at', type: 'date', nullable: true }) shotAt: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) attributes: AssetAttributes;
  @Column({ name: 'quality_grade', type: 'varchar', length: 1, default: 'B' }) qualityGrade: QualityGrade;
  @Column({ name: 'tagging_status', type: 'varchar', length: 20, default: 'PENDING' }) taggingStatus: TaggingStatus;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: AssetStatus;

  @OneToMany(() => AssetLicense, (l) => l.asset) licenses?: AssetLicense[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
}
