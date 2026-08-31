import type { ContentStatus, OrderStatus, TaskState } from '../types/enums';

/** §2.3 상태 정의를 코드로 옮긴 것. 잘못된 전이는 여기서 막는다. */

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT:      ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['REJECTED', 'QUEUED', 'DRAFT'],
  REJECTED:   ['DRAFT', 'CANCELLED'],
  QUEUED:     ['RUNNING', 'CANCELLED'],
  RUNNING:    ['DONE', 'PARTIAL', 'CANCELLED'],
  PARTIAL:    ['DONE', 'CANCELLED'],
  DONE:       [],
  CANCELLED:  [],
};

const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  PENDING:    ['GENERATING', 'FAILED'],
  GENERATING: ['RENDERING', 'QC', 'FAILED', 'BLOCKED'],
  RENDERING:  ['QC', 'FAILED'],
  QC:         ['READY', 'APPROVED', 'QC_FAILED', 'BLOCKED', 'GENERATING', 'RENDERING', 'FAILED'],
  QC_FAILED:  ['GENERATING', 'RENDERING', 'REJECTED'],
  READY:      ['APPROVED', 'REJECTED', 'GENERATING', 'RENDERING'],
  APPROVED:   ['PUBLISHING', 'REJECTED'],
  REJECTED:   ['GENERATING', 'RENDERING'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED:  [],
  BLOCKED:    [],
  FAILED:     ['GENERATING', 'RENDERING'],
};

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  QUEUED:    ['RUNNING', 'CANCELLED'],
  RUNNING:   ['DONE', 'RETRY', 'FALLBACK', 'ESCALATED', 'FAILED', 'CANCELLED'],
  RETRY:     ['RUNNING', 'ESCALATED', 'CANCELLED'],
  FALLBACK:  ['RUNNING', 'ESCALATED', 'CANCELLED'],
  ESCALATED: ['RUNNING', 'CANCELLED', 'FAILED'],
  DONE:      [],
  FAILED:    ['RUNNING'],   // 운영자 수동 재시도
  CANCELLED: [],
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  from === to || ORDER_TRANSITIONS[from].includes(to);
export const canTransitionContent = (from: ContentStatus, to: ContentStatus): boolean =>
  from === to || CONTENT_TRANSITIONS[from].includes(to);
export const canTransitionTask = (from: TaskState, to: TaskState): boolean =>
  from === to || TASK_TRANSITIONS[from].includes(to);

/** 오더 진행률 5단계 (§7.2 대시보드) */
export const ORDER_STAGES = ['SELECTION', 'GENERATION', 'QC', 'APPROVAL', 'PUBLISH'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export function contentStage(status: ContentStatus): OrderStage {
  switch (status) {
    case 'PENDING': return 'SELECTION';
    case 'GENERATING':
    case 'RENDERING': return 'GENERATION';
    case 'QC':
    case 'QC_FAILED': return 'QC';
    case 'READY':
    case 'REJECTED':
    case 'BLOCKED': return 'APPROVAL';
    case 'APPROVED':
    case 'PUBLISHING':
    case 'PUBLISHED': return 'PUBLISH';
    default: return 'GENERATION';
  }
}

export const TERMINAL_CONTENT_STATUSES: ContentStatus[] = ['PUBLISHED', 'BLOCKED', 'REJECTED', 'FAILED'];
export const isContentTerminal = (s: ContentStatus): boolean => TERMINAL_CONTENT_STATUSES.includes(s);
