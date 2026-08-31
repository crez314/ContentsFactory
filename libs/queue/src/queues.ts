import type { TaskKind } from '@cf/domain';

/** §3.1 큐 구조 — 작업 종류별로 분리하고 동시성을 다르게 준다. */
export const QUEUE = {
  SELECTION:      'q.selection',
  BLUEPRINT:      'q.blueprint',
  GENERATE_IMAGE: 'q.generate.image',
  GENERATE_VIDEO: 'q.generate.video',
  RENDER:         'q.render',
  QC:             'q.qc',
  PUBLISH:        'q.publish',
  /** 워커→오케스트레이터 완료 통지. 워커가 다음 단계 큐에 직접 넣지 않기 위한 것이다 (§3.2 원칙). */
  ORCHESTRATE:    'q.orchestrate',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface QueueSpec {
  name: QueueName;
  concurrency: number;
  maxRetry: number;
  /** SLA 산정 기준 (평균 소요의 상한) */
  slaMs: number;
}

export const QUEUE_SPECS: Record<TaskKind, QueueSpec> = {
  SELECTION:      { name: QUEUE.SELECTION,      concurrency: 10, maxRetry: 2, slaMs: 60_000 },
  BLUEPRINT:      { name: QUEUE.BLUEPRINT,      concurrency: 10, maxRetry: 2, slaMs: 60_000 },
  GENERATE_IMAGE: { name: QUEUE.GENERATE_IMAGE, concurrency: 8,  maxRetry: 3, slaMs: 180_000 },
  GENERATE_VIDEO: { name: QUEUE.GENERATE_VIDEO, concurrency: 4,  maxRetry: 3, slaMs: 900_000 },
  RENDER:         { name: QUEUE.RENDER,         concurrency: 2,  maxRetry: 2, slaMs: 600_000 },
  QC:             { name: QUEUE.QC,             concurrency: 8,  maxRetry: 2, slaMs: 120_000 },
  PUBLISH:        { name: QUEUE.PUBLISH,        concurrency: 4,  maxRetry: 3, slaMs: 180_000 },
};

export const queueFor = (kind: TaskKind): QueueSpec => QUEUE_SPECS[kind];

export const ALL_WORK_QUEUES: QueueName[] = Object.values(QUEUE_SPECS).map((s) => s.name);
