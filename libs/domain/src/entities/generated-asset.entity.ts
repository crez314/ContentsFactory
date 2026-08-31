import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { GeneratedKind } from '../types/enums';
import { numericTransformer } from './_transformers';

@Entity('generated_assets')
export class GeneratedAsset {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  @Column({ name: 'scene_id', type: 'uuid', nullable: true }) sceneId: string | null;
  @Column({ type: 'varchar', length: 20 }) kind: GeneratedKind;
  @Column({ name: 'storage_key', type: 'text' }) storageKey: string;
  /** 어댑터 이름. 벤더명은 어댑터 구현체 밖으로 새어나가지 않는다 (§4.5). */
  @Column({ type: 'varchar', length: 60 }) provider: string;
  @Column({ name: 'model_version', type: 'varchar', length: 80, nullable: true }) modelVersion: string | null;
  @Column({ name: 'cost_krw', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  costKrw: number;
  @Column({ name: 'latency_ms', type: 'int', nullable: true }) latencyMs: number | null;
  @Column({ name: 'identity_score', type: 'numeric', precision: 5, scale: 4, nullable: true, transformer: numericTransformer })
  identityScore: number | null;
  /** §9.4 중복 호출 방지 해시 */
  @Column({ name: 'cache_key', type: 'varchar', length: 64, nullable: true }) cacheKey: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) meta: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
