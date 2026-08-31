import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { QcVerdict } from '../types/enums';
import type { QcAreaScores, QcViolation } from '../types/json-shapes';
import { numericTransformer } from './_transformers';

@Entity('qc_results')
export class QcResult {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  @Column({ type: 'smallint', default: 1 }) attempt: number;
  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer })
  totalScore: number;
  @Column({ type: 'varchar', length: 12 }) verdict: QcVerdict;
  @Column({ name: 'area_scores', type: 'jsonb' }) areaScores: QcAreaScores;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) violations: QcViolation[];
  /** 최저 점수 영역. FAIL 시 이 영역에 해당하는 모듈만 재실행한다 (§3.3). */
  @Column({ name: 'retry_target', type: 'varchar', length: 20, nullable: true }) retryTarget: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
