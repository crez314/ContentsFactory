/**
 * §10 에러 코드 체계 — {DOMAIN}_{REASON}
 * HTTP 상태는 이 표가 단일 출처다. 컨트롤러에서 상태코드를 직접 쓰지 않는다.
 */
export const ERROR_CATALOG = {
  AUTH_INVALID_CREDENTIALS: { http: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
  AUTH_TOKEN_EXPIRED:       { http: 401, message: '액세스 토큰이 만료되었습니다.' },
  AUTH_FORBIDDEN:           { http: 403, message: '권한이 부족합니다.' },
  AUTH_ACCOUNT_LOCKED:      { http: 423, message: '로그인 실패 횟수 초과로 계정이 잠겼습니다.' },
  SELF_APPROVAL_DENIED:     { http: 403, message: '본인이 생성한 오더의 콘텐츠는 승인할 수 없습니다.' },

  ASSET_NOT_FOUND:          { http: 404, message: '자산을 찾을 수 없습니다.' },
  ASSET_UPLOAD_NOT_FOUND:   { http: 400, message: '스토리지에 업로드가 완료되지 않았습니다.' },
  ARTIST_INACTIVE:          { http: 422, message: '아티스트가 활성 상태가 아닙니다.' },
  CHANNEL_INACTIVE:         { http: 422, message: '대상 채널이 활성 상태가 아닙니다.' },

  ORDER_NOT_FOUND:          { http: 404, message: '오더를 찾을 수 없습니다.' },
  ORDER_INVALID_STATE:      { http: 409, message: '현재 상태에서 불가능한 전이입니다.' },
  ORDER_VALIDATION_FAILED:  { http: 422, message: '오더 사전 검증에 실패했습니다.' },

  INSUFFICIENT_ASSETS:      { http: 422, message: '조건에 맞는 자산이 부족합니다.' },
  LICENSE_CHANNEL_DENIED:   { http: 422, message: '해당 채널·지역에서 사용할 수 없는 자산입니다.' },
  LICENSE_EXPIRED:          { http: 422, message: '선택한 자산의 라이선스가 게시 예정일 이전에 만료됩니다.' },
  DERIVATIVE_DENIED:        { http: 422, message: '2차 가공이 허용되지 않은 자산입니다.' },
  SPEC_MISMATCH:            { http: 422, message: '채널 규격과 오더 사양이 일치하지 않습니다.' },
  BUDGET_EXCEEDED:          { http: 422, message: '예상 비용이 오더 예산 상한을 초과합니다.' },
  AGENT_BUDGET_EXCEEDED:    { http: 422, message: '에이전트 일일 잔여 예산을 초과합니다.' },
  POLICY_VIOLATION:         { http: 422, message: '브랜드·금지주제 정책에 저촉됩니다.' },

  CONTENT_NOT_FOUND:        { http: 404, message: '콘텐츠를 찾을 수 없습니다.' },
  CONTENT_INVALID_STATE:    { http: 409, message: '현재 상태에서 불가능한 전이입니다.' },

  BACKEND_UNAVAILABLE:      { http: 503, message: '사용 가능한 생성 어댑터가 없습니다.' },
  IDENTITY_REJECTED:        { http: 422, message: '동일성 기준 미달로 재시도가 소진되었습니다.' },
  QC_BLOCKED:               { http: 422, message: '정책·저작권 위반으로 차단되었습니다.' },
  RETRY_EXHAUSTED:          { http: 500, message: '재시도가 소진되었습니다.' },
  PLATFORM_UPLOAD_FAILED:   { http: 502, message: '채널 업로드에 실패했습니다.' },
  RATE_LIMITED:             { http: 429, message: '호출 한도를 초과했습니다.' },

  TASK_NOT_FOUND:           { http: 404, message: 'Task 를 찾을 수 없습니다.' },
  TASK_INVALID_STATE:       { http: 409, message: '현재 상태에서 불가능한 Task 전이입니다.' },
  INVALID_INPUT:            { http: 400, message: '입력값이 올바르지 않습니다.' },
  NOT_FOUND:                { http: 404, message: '대상을 찾을 수 없습니다.' },
  CONFLICT:                 { http: 409, message: '충돌이 발생했습니다.' },
  INTERNAL_ERROR:           { http: 500, message: '내부 오류가 발생했습니다.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;
