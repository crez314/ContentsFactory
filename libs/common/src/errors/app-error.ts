import { ERROR_CATALOG, ErrorCode } from './error-codes';

/** §3.4 실패 유형 분류 — Orchestrator 재시도 전략의 입력이 된다. */
export type FailureClass =
  | 'TRANSIENT'
  | 'BACKEND_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'POLICY_VIOLATION'
  | 'INVALID_INPUT'
  | 'RETRY_EXHAUSTED';

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
      return 'INVALID_INPUT';
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
