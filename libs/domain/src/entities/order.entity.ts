import {
  Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { OrderStatus, OutputType } from '../types/enums';
import type { AssetFilter, OrderConcept, OrderDesign, OrderSpec } from '../types/json-shapes';
import { Artist } from './artist.entity';
import { Agent } from './agent.entity';
import { Channel } from './channel.entity';
import { User } from './user.entity';
import { numericTransformer } from './_transformers';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** ORD-YYYYMMDD-NNNN */
  @Column({ name: 'order_no', type: 'varchar', length: 30, unique: true }) orderNo: string;

  @Column({ name: 'artist_id', type: 'uuid' }) artistId: string;
  @ManyToOne(() => Artist) @JoinColumn({ name: 'artist_id' }) artist?: Artist;

  @Column({ name: 'requested_by', type: 'uuid' }) requestedBy: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'requested_by' }) requester?: User;

  /** 이 오더의 생성 주체. 예산·승인레벨 판정의 기준이 된다. */
  @Column({ name: 'agent_id', type: 'uuid', nullable: true }) agentId: string | null;
  @ManyToOne(() => Agent) @JoinColumn({ name: 'agent_id' }) agent?: Agent;

  @Column({ name: 'output_type', type: 'varchar', length: 20 }) outputType: OutputType;
  @Column({ type: 'int' }) quantity: number;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) concept: OrderConcept;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) design: OrderDesign;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) spec: OrderSpec;
  @Column({ name: 'asset_filter', type: 'jsonb', default: () => "'{}'::jsonb" }) assetFilter: AssetFilter;
  @Column({ name: 'budget_cap', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  budgetCap: number;
  @Column({ name: 'approval_level', type: 'smallint', default: 0 }) approvalLevel: number;
  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true }) scheduledAt: Date | null;
  @Column({ type: 'varchar', length: 24, default: 'DRAFT' }) status: OrderStatus;
  @Column({ name: 'reject_reason', type: 'jsonb', nullable: true }) rejectReason: unknown;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 160, nullable: true }) idempotencyKey: string | null;

  @ManyToMany(() => Channel, { eager: false })
  @JoinTable({
    name: 'order_channels',
    joinColumn: { name: 'order_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'channel_id', referencedColumnName: 'id' },
  })
  channels?: Channel[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
