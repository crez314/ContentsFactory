import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { ContentStatus, OutputType } from '../types/enums';
import { Blueprint } from './blueprint.entity';
import { Order } from './order.entity';
import { Scene } from './scene.entity';

@Entity('contents')
export class Content {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'blueprint_id', type: 'uuid' }) blueprintId: string;
  @ManyToOne(() => Blueprint) @JoinColumn({ name: 'blueprint_id' }) blueprint?: Blueprint;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  @ManyToOne(() => Order) @JoinColumn({ name: 'order_id' }) order?: Order;

  @Column({ type: 'varchar', length: 200, nullable: true }) title: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'text', array: true, default: () => "'{}'" }) hashtags: string[];
  @Column({ name: 'output_type', type: 'varchar', length: 20 }) outputType: OutputType;
  /** 최종 산출물 스토리지 키 */
  @Column({ name: 'final_key', type: 'text', nullable: true }) finalKey: string | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @Column({ type: 'varchar', length: 24, default: 'PENDING' }) status: ContentStatus;

  @OneToMany(() => Scene, (s) => s.content) scenes?: Scene[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
