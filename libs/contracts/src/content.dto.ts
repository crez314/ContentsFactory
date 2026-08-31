import { z } from 'zod';
import { QC_AREAS } from '@cf/domain';

export const DecisionDto = z.object({ comment: z.string().max(2000).optional() });
export type DecisionDto = z.infer<typeof DecisionDto>;

export const RegenerateDto = z.object({
  /** QC 영역을 지정하면 그 영역에 대응하는 모듈만 다시 돌린다 (§3.3). */
  target: z.enum(QC_AREAS as unknown as [string, ...string[]]).optional(),
  sceneId: z.string().uuid().optional(),
});
export type RegenerateDto = z.infer<typeof RegenerateDto>;

export const PublicizeDto = z.object({
  visibility: z.enum(['PUBLIC', 'UNLISTED']).default('PUBLIC'),
});
export type PublicizeDto = z.infer<typeof PublicizeDto>;
