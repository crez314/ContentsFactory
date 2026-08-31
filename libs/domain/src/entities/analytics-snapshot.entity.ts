import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer, numericTransformer } from './_transformers';

/** V1 에서는 스키마만 확보한다. 수집은 V2 (§13). */
@Entity('analytics_snapshots')
export class AnalyticsSnapshot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'publication_id', type: 'uuid' }) publicationId: string;
  @Column({ name: 'collected_at', type: 'timestamptz' }) collectedAt: Date;
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer }) views: number;
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer }) likes: number;
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer }) comments: number;
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer }) shares: number;
  @Column({ name: 'avg_view_ms', type: 'int', nullable: true }) avgViewMs: number | null;
  @Column({ name: 'retention_rate', type: 'numeric', precision: 5, scale: 4, nullable: true, transformer: numericTransformer })
  retentionRate: number | null;
  @Column({ name: 'follows_gained', type: 'int', nullable: true }) followsGained: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
