import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ArtistStatus } from '../types/enums';
import type { IdentityRef } from '../types/json-shapes';

@Entity('artists')
export class Artist {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 30, unique: true }) code: string;
  /** 기준 임베딩 세트 메타 (스토리지 키 목록) */
  @Column({ name: 'identity_ref', type: 'jsonb', nullable: true }) identityRef: IdentityRef | null;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: ArtistStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
}
