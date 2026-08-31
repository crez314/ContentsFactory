import type { ErrorCode } from '@cf/common';

export interface ValidationError {
  code: Extract<ErrorCode,
    | 'ARTIST_INACTIVE' | 'CHANNEL_INACTIVE' | 'SPEC_MISMATCH' | 'INSUFFICIENT_ASSETS'
    | 'LICENSE_CHANNEL_DENIED' | 'LICENSE_EXPIRED' | 'DERIVATIVE_DENIED'
    | 'BUDGET_EXCEEDED' | 'AGENT_BUDGET_EXCEEDED' | 'POLICY_VIOLATION'>;
  detail: Record<string, unknown>;
}

export interface ValidationOk {
  ok: true;
  errors: [];
  estimatedCostKrw: number;
  candidateCount: number;
}
export interface ValidationFail {
  ok: false;
  errors: ValidationError[];
  estimatedCostKrw: number;
  candidateCount: number;
}
export type ValidationResult = ValidationOk | ValidationFail;

/** §4.2 검증 항목 — 순서대로 수행하고 첫 실패에서 중단한다. */
export const VALIDATION_STEPS = [
  { no: 1,  code: 'ARTIST_INACTIVE',        label: '아티스트 상태가 ACTIVE 인가' },
  { no: 2,  code: 'CHANNEL_INACTIVE',       label: '대상 채널이 모두 ACTIVE 인가' },
  { no: 3,  code: 'SPEC_MISMATCH',          label: '오더 사양이 채널 규격에 부합하는가' },
  { no: 4,  code: 'INSUFFICIENT_ASSETS',    label: '조건에 맞는 자산이 최소 수량 이상 존재하는가' },
  { no: 5,  code: 'LICENSE_CHANNEL_DENIED', label: '라이선스가 대상 채널·지역을 허용하는가' },
  { no: 6,  code: 'LICENSE_EXPIRED',        label: '라이선스 유효기간이 게시 예정일 이후인가' },
  { no: 7,  code: 'DERIVATIVE_DENIED',      label: '2차 가공이 허용되는가' },
  { no: 8,  code: 'BUDGET_EXCEEDED',        label: '예상 비용이 오더 예산 상한 이내인가' },
  { no: 9,  code: 'AGENT_BUDGET_EXCEEDED',  label: '예상 비용이 에이전트 일일 잔여 예산 이내인가' },
  { no: 10, code: 'POLICY_VIOLATION',       label: '금지 주제·브랜드 정책에 저촉되지 않는가' },
] as const;
