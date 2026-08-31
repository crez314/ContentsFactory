import { z } from 'zod';
import { TASK_KIND } from '@cf/domain';

/** §3.2 모든 Job 이 갖는 공통 봉투. 워커는 실행 전에 이 스키마로 런타임 검증한다. */
export const JobEnvelope = z.object({
  taskId:         z.string().uuid(),
  kind:           z.enum(TASK_KIND),
  orderId:        z.string().uuid().optional(),
  contentId:      z.string().uuid().optional(),
  sceneId:        z.string().uuid().optional(),
  agentId:        z.string().uuid().optional(),
  attempt:        z.number().int().min(1),
  idempotencyKey: z.string().min(8),
  budgetCapKrw:   z.number().nonnegative(),
  deadline:       z.string().datetime(),
  payload:        z.unknown(),
});
export type JobEnvelope = z.infer<typeof JobEnvelope>;

/** 워커 → 오케스트레이터 완료 통지 */
export const TaskCompletion = z.object({
  taskId: z.string().uuid(),
  outcome: z.enum(['DONE', 'FAILED', 'ESCALATED']),
});
export type TaskCompletion = z.infer<typeof TaskCompletion>;
