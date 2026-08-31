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
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
