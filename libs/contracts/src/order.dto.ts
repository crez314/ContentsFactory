import { z } from 'zod';
import { OUTPUT_TYPE } from '@cf/domain';

/** §2.2 orders.asset_filter */
export const AssetFilterDto = z.object({
  include: z.record(z.string(), z.array(z.string())).optional(),
  exclude: z.record(z.string(), z.array(z.string())).optional(),
}).default({});

/** §2.2 orders.spec */
export const OrderSpecDto = z.object({
  aspect: z.string().optional(),
  durationSec: z.number().int().min(5).max(600).optional(),
  resolution: z.string().optional(),
}).default({});

export const CreateOrderDto = z.object({
  artistId: z.string().uuid(),
  channelIds: z.array(z.string().uuid()).min(1),
  agentId: z.string().uuid().optional(),
  outputType: z.enum(OUTPUT_TYPE),
  quantity: z.number().int().min(1).max(100),
  concept: z.record(z.string(), z.unknown()).default({}),
  design: z.record(z.string(), z.unknown()).default({}),
  spec: OrderSpecDto,
  assetFilter: AssetFilterDto,
  budgetCapKrw: z.number().nonnegative().default(0),
  approvalLevel: z.number().int().min(0).max(3).default(0),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type CreateOrderDto = z.infer<typeof CreateOrderDto>;

export const UpdateOrderDto = CreateOrderDto.partial();
export type UpdateOrderDto = z.infer<typeof UpdateOrderDto>;

/** §7.2 오더 콘솔 5단계 실시간 후보 수 */
export const PreviewCandidatesDto = z.object({
  artistId: z.string().uuid(),
  channelIds: z.array(z.string().uuid()).default([]),
  assetFilter: AssetFilterDto,
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type PreviewCandidatesDto = z.infer<typeof PreviewCandidatesDto>;
