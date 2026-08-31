import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './_transformers';

/**
 * 콘텐츠 계보 (Content Lineage) — §2.1 의 핵심 테이블.
 * 「어떤 콘텐츠가 어떤 원본 자산에서 나왔는가」를 저장하며 V2 성과 역추적의 전제가 된다.
 */
@Entity('asset_usages')
export class AssetUsage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  @Column({ name: 'asset_id', type: 'uuid' }) assetId: string;
  @Column({ name: 'scene_id', type: 'uuid', nullable: true }) sceneId: string | null;
  /** 복수 자산 사용 시 배분 비율. 합이 1이 되도록 기록한다. */
  @Column({ name: 'usage_weight', type: 'numeric', precision: 5, scale: 4, default: 1, transformer: numericTransformer })
  usageWeight: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
