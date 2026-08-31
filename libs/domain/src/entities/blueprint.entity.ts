import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { OutputType } from '../types/enums';
import type { BlueprintLayout, BlueprintStyle, ScenePlan } from '../types/json-shapes';
import { Channel } from './channel.entity';

@Entity('blueprints')
export class Blueprint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId: string;
  @ManyToOne(() => Channel) @JoinColumn({ name: 'channel_id' }) channel?: Channel;
  /** 오더 내 n번째 산출물 */
  @Column({ type: 'int' }) seq: number;
  @Column({ name: 'output_type', type: 'varchar', length: 20 }) outputType: OutputType;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) layout: BlueprintLayout;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) style: BlueprintStyle;
  @Column({ name: 'scene_plan', type: 'jsonb', default: () => "'[]'::jsonb" }) scenePlan: ScenePlan[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
