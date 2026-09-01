import { CHANNEL_HEALTH_STATE, CHANNEL_HEALTH_LABELS_KO } from '@cf/domain';
import { ERROR_CATALOG } from '@cf/common';

/**
 * §4.9 Channel Health.
 * 서비스 자체는 DB 를 쓰므로 E2E 에서 검증하고, 여기서는 계약과 정책 상수를 고정한다.
 */
describe('§4.9 Channel Health 계약', () => {
  it('상태는 세 가지다', () => {
    expect([...CHANNEL_HEALTH_STATE]).toEqual(['ACTIVE', 'THROTTLED', 'QUARANTINE']);
  });

  it('모든 상태에 한글 라벨이 있다', () => {
    for (const s of CHANNEL_HEALTH_STATE) expect(CHANNEL_HEALTH_LABELS_KO[s]).toBeTruthy();
  });

  it('헤드룸 초과는 429 — 실패가 아니라 이월이다', () => {
    expect(ERROR_CATALOG.CHANNEL_HEADROOM_EXCEEDED.http).toBe(429);
  });

  it('격리는 409 — 운영자 개입이 필요한 충돌 상태다', () => {
    expect(ERROR_CATALOG.CHANNEL_QUARANTINED.http).toBe(409);
  });
});

describe('§4.8.1 정품 표식 계약', () => {
  it('표식 생성 실패는 500 — 게시를 중단시킨다', () => {
    expect(ERROR_CATALOG.PROVENANCE_SIGNING_FAILED.http).toBe(500);
  });
});

describe('§4.3 선별 반려 계약', () => {
  it('두 반려 사유 모두 422 — 생성 비용이 발생하기 전에 막는다', () => {
    expect(ERROR_CATALOG.SELECTION_NO_ELIGIBLE_ASSET.http).toBe(422);
    expect(ERROR_CATALOG.SELECTION_INSUFFICIENT_COVERAGE.http).toBe(422);
  });
});
