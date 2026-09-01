import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Asset } from './asset.entity';

@Entity('asset_licenses')
export class AssetLicense {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'asset_id', type: 'uuid' }) assetId: string;
  @ManyToOne(() => Asset, (a) => a.licenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' }) asset?: Asset;

  /** 소문자 플랫폼 키. 예: {'youtube','instagram'} */
  @Column({ name: 'allowed_channels', type: 'text', array: true, default: () => "'{}'" }) allowedChannels: string[];
  /** ISO 국가코드. 예: {'KR','JP'} */
  @Column({ name: 'allowed_regions', type: 'text', array: true, default: () => "'{}'" }) allowedRegions: string[];
  @Column({ name: 'derivative_allowed', type: 'boolean', default: true }) derivativeAllowed: boolean;
  /**
   * §4.3 2차 가공 허용 수준 (0 불허 / 1 단순편집 / 2 합성·변형 / 3 AI 생성).
   * derivative_allowed 로는 "어느 수준까지"를 표현하지 못해 단계값으로 승격했다.
   */
  @Column({ name: 'derivative_level', type: 'smallint', default: 0 }) derivativeLevel: number;
  @Column({ name: 'valid_from', type: 'date' }) validFrom: string;
  @Column({ name: 'valid_until', type: 'date' }) validUntil: string;
  @Column({ name: 'contract_ref', type: 'varchar', length: 120, nullable: true }) contractRef: string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
