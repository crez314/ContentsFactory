import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './_transformers';
import type { AssetAttributes } from '../types/json-shapes';

/**
 * §4.3 자산 커버리지 부족 기록.
 *
 * SELECTION_INSUFFICIENT_COVERAGE 는 시스템 실패가 아니라 촬영 계획의 입력이다.
 * 어떤 속성 조합의 오더가 반복적으로 반려되는지가 다음 촬영에서 확보해야 할 조합이다.
 * V1 은 적재만 하고, V2 촬영 가이드 환류에서 사용한다.
 */
@Entity('coverage_gaps')
export class CoverageGap {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  @Column({ name: 'artist_id', type: 'uuid' }) artistId: string;
  @Column({ name: 'requested_attributes', type: 'jsonb' }) requestedAttributes: AssetAttributes;
  @Column({ name: 'best_fit_score', type: 'numeric', precision: 6, scale: 2, nullable: true, transformer: numericTransformer })
  bestFitScore: number | null;
  @Column({ name: 'best_asset_id', type: 'uuid', nullable: true }) bestAssetId: string | null;
  @Column({ type: 'varchar', length: 40, default: 'INSUFFICIENT_COVERAGE' }) reason: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
