import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** §4.1 자산 속성 표준값. 자유 입력을 허용하면 매칭이 불가능해지므로 마스터로 고정한다. */
@Entity('master_attribute_values')
export class MasterAttributeValue {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40 }) attribute: string;
  @Column({ type: 'varchar', length: 60 }) value: string;
  @Column({ name: 'label_ko', type: 'varchar', length: 60, nullable: true }) labelKo: string | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

/** §4.6 brand·policy 룰셋의 금지어 사전 */
@Entity('master_banned_terms')
export class MasterBannedTerm {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120, unique: true }) term: string;
  @Column({ type: 'varchar', length: 30, default: 'BRAND' }) category: 'BRAND' | 'POLICY' | 'TOPIC';
  @Column({ type: 'varchar', length: 10, default: 'WARN' }) severity: 'WARN' | 'BLOCK';
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
