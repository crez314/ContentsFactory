import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Asset } from './asset.entity';
import { numericTransformer } from './_transformers';

export interface SelectionReason {
  matched: Record<string, string[]>;
  licenseOk: boolean;
  validUntil: string;
  breakdown?: Record<string, number>;
}

@Entity('selections')
export class Selection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  @Column({ name: 'asset_id', type: 'uuid' }) assetId: string;
  @ManyToOne(() => Asset) @JoinColumn({ name: 'asset_id' }) asset?: Asset;
  @Column({ type: 'int' }) rank: number;
  @Column({ name: 'fit_score', type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer })
  fitScore: number;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) reason: SelectionReason;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
