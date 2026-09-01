import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { PublicationStatus, Visibility } from '../types/enums';
import { Channel } from './channel.entity';
import { Content } from './content.entity';

@Entity('publications')
export class Publication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id', type: 'uuid' }) contentId: string;
  @ManyToOne(() => Content) @JoinColumn({ name: 'content_id' }) content?: Content;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId: string;
  @ManyToOne(() => Channel) @JoinColumn({ name: 'channel_id' }) channel?: Channel;
  @Column({ name: 'external_id', type: 'varchar', length: 120, nullable: true }) externalId: string | null;
  @Column({ name: 'external_url', type: 'text', nullable: true }) externalUrl: string | null;
  /** V1 은 PRIVATE 업로드 고정. 공개 전환은 운영자가 백오피스에서 수행한다 (§4.8). */
  @Column({ type: 'varchar', length: 12, default: 'PRIVATE' }) visibility: Visibility;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: PublicationStatus;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true }) publishedAt: Date | null;
  @Column({ type: 'jsonb', nullable: true }) error: unknown;

  // ─────────── §4.8.1 정품 표식. 계보는 사후 소급 생성이 불가능하므로 첫 게시부터 남긴다.
  /** C2PA 매니페스트 식별자 — 플랫폼 업로드 과정에서 제거되는 경우가 많다 */
  @Column({ name: 'provenance_manifest_id', type: 'text', nullable: true }) provenanceManifestId: string | null;
  /** 재인코딩·크롭 이후에도 잔존하는 워터마크 식별자 */
  @Column({ name: 'watermark_id', type: 'text', nullable: true }) watermarkId: string | null;
  /** 최후 대조 수단. 인덱스가 걸려 있다. */
  @Column({ type: 'text', nullable: true }) phash: string | null;
  @Column({ name: 'frame_signature', type: 'jsonb', nullable: true }) frameSignature: unknown;

  // ─────────── §13 V2 다채널 병렬 실험. V1 은 컬럼만 확보하고 쓰지 않는다.
  @Column({ name: 'experiment_id', type: 'uuid', nullable: true }) experimentId: string | null;
  @Column({ name: 'variant_key', type: 'text', nullable: true }) variantKey: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
