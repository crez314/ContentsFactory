import { ERROR_CATALOG, ErrorCode } from './error-codes';

/** §3.4 실패 유형 분류 — Orchestrator 재시도 전략의 입력이 된다. */
export type FailureClass =
  | 'TRANSIENT'
  | 'BACKEND_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'POLICY_VIOLATION'
  | 'INVALID_INPUT'
  | 'RETRY_EXHAUSTED'
  /**
   * v1.1 §4.9 — 실패가 아니라 이월이다.
   * 채널 안전 한도에 걸린 게시는 다음 슬롯에 그대로 다시 시도하며,
   * 재시도 예산을 소모하지 않는다. 콘텐츠 상태도 건드리지 않는다.
   */
  | 'DEFERRED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  readonly details: unknown[];
  readonly failureClass: FailureClass;

  constructor(
    code: ErrorCode,
    opts: { details?: unknown[]; message?: string; failureClass?: FailureClass; cause?: unknown } = {},
  ) {
    const entry = ERROR_CATALOG[code];
    super(opts.message ?? entry.message);
    this.name = 'AppError';
    this.code = code;
    this.http = entry.http;
    this.details = opts.details ?? [];
    this.failureClass = opts.failureClass ?? defaultFailureClass(code);
    if (opts.cause) (this as { cause?: unknown }).cause = opts.cause;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

function defaultFailureClass(code: ErrorCode): FailureClass {
  switch (code) {
    case 'BACKEND_UNAVAILABLE':
    case 'RATE_LIMITED':
      return 'BACKEND_UNAVAILABLE';
    case 'BUDGET_EXCEEDED':
    case 'AGENT_BUDGET_EXCEEDED':
      return 'BUDGET_EXCEEDED';
    case 'POLICY_VIOLATION':
    case 'QC_BLOCKED':
    case 'LICENSE_EXPIRED':
    case 'LICENSE_CHANNEL_DENIED':
    case 'DERIVATIVE_DENIED':
      return 'POLICY_VIOLATION';
    case 'INVALID_INPUT':
    case 'SPEC_MISMATCH':
    case 'INSUFFICIENT_ASSETS':
    // 선별 반려는 재시도해도 결과가 같다. 자산을 늘리거나 조건을 바꿔야 한다.
    case 'SELECTION_NO_ELIGIBLE_ASSET':
    case 'SELECTION_INSUFFICIENT_COVERAGE':
      return 'INVALID_INPUT';
    // §4.9 채널 여유 부족·격리는 콘텐츠 문제가 아니다. 이월한다.
    case 'CHANNEL_HEADROOM_EXCEEDED':
    case 'CHANNEL_QUARANTINED':
      return 'DEFERRED';
    // §4.8.1 표식 생성 실패는 일시 오류일 수 있으므로 재시도하고, 소진되면 에스컬레이션한다.
    // 콘텐츠 자체는 정상이므로 BLOCKED 로 내리지 않는다.
    case 'PROVENANCE_SIGNING_FAILED':
      return 'TRANSIENT';
    case 'RETRY_EXHAUSTED':
      return 'RETRY_EXHAUSTED';
    default:
      return 'TRANSIENT';
  }
}

export class BackendUnavailableError extends AppError {
  constructor(capability: string, opts: { cause?: unknown } = {}) {
    super('BACKEND_UNAVAILABLE', {
      message: `사용 가능한 ${capability} 어댑터가 없습니다.`,
      details: [{ capability }],
      cause: opts.cause,
    });
    this.name = 'BackendUnavailableError';
  }
}

export class BudgetExceededError extends AppError {
  constructor(agentId: string | undefined, detail: Record<string, unknown> = {}) {
    super('AGENT_BUDGET_EXCEEDED', { details: [{ agentId, ...detail }] });
    this.name = 'BudgetExceededError';
  }
}

export class IdentityRejectedError extends AppError {
  constructor(contentId: string | undefined, detail: Record<string, unknown> = {}) {
    super('IDENTITY_REJECTED', { details: [{ contentId, ...detail }] });
    this.name = 'IdentityRejectedError';
  }
}

export class PolicyViolationError extends AppError {
  constructor(violations: unknown[]) {
    super('POLICY_VIOLATION', { details: violations });
    this.name = 'PolicyViolationError';
  }
}

/** 외부 호출 실패를 TRANSIENT 로 감싸 재시도 대상으로 만든다. */
export class TransientError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('INTERNAL_ERROR', { message, failureClass: 'TRANSIENT', cause });
    this.name = 'TransientError';
  }
}

export function classify(err: unknown): FailureClass {
  if (err instanceof AppError) return err.failureClass;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(msg)) return 'TRANSIENT';
  return 'TRANSIENT';
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details, failureClass: err.failureClass };
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', name: err.name, message: err.message, stack: err.stack?.slice(0, 4000) };
  }
  return { code: 'INTERNAL_ERROR', message: String(err) };
}
