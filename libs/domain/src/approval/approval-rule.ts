import type { QcVerdict } from '../types/enums';
import type { QcViolation } from '../types/json-shapes';

export interface ApprovalInput {
  verdict: QcVerdict;
  totalScore: number;
  violations: QcViolation[];
}

/**
 * §4.7 승인 레벨별 자동 승인 규칙.
 * 레벨은 V1 에서 운영자가 수동 설정한다. 실적 기반 자동 상향은 V2.
 */
export const APPROVAL_RULE: Record<number, (q: ApprovalInput) => boolean> = {
  0: () => false,                                              // 전건 수동
  1: (q) => q.totalScore >= 92 && q.violations.length === 0,
  2: (q) => q.totalScore >= 85,
  3: (q) => q.verdict === 'PASS',
};

export const APPROVAL_LEVEL_LABELS_KO: Record<number, string> = {
  0: 'L0 전건 수동 승인',
  1: 'L1 92점 이상 + 위반 없음 자동',
  2: 'L2 85점 이상 자동',
  3: 'L3 QC PASS 전건 자동',
};

export function shouldAutoApprove(level: number, qc: ApprovalInput): boolean {
  if (qc.verdict === 'BLOCKED') return false;
  if (qc.verdict === 'FAIL') return false;
  const rule = APPROVAL_RULE[level] ?? APPROVAL_RULE[0];
  return rule(qc);
}

/**
 * §6.2 4-eyes 원칙 — 오더를 생성한 본인은 자기 콘텐츠를 승인할 수 없다.
 * SUPER_ROOT 만 예외로 둔다.
 */
export function violatesFourEyes(args: {
  orderRequestedBy: string;
  actorId: string;
  actorRole: string;
}): boolean {
  if (args.actorRole === 'SUPER_ROOT') return false;
  return args.orderRequestedBy === args.actorId;
}
