import { APPROVAL_RULE, shouldAutoApprove, violatesFourEyes } from '@cf/domain';

const pass = (totalScore: number, violations: unknown[] = []) =>
  ({ verdict: 'PASS' as const, totalScore, violations: violations as never[] });

describe('§4.7 승인 규칙', () => {
  it('레벨 0 은 전건 수동 — 100점이어도 자동 승인하지 않는다', () => {
    expect(shouldAutoApprove(0, pass(100))).toBe(false);
  });

  it('레벨 1 은 92점 이상 + 위반 없음', () => {
    expect(shouldAutoApprove(1, pass(92))).toBe(true);
    expect(shouldAutoApprove(1, pass(91.99))).toBe(false);
    expect(shouldAutoApprove(1, pass(95, [{ code: 'X' }]))).toBe(false);
  });

  it('레벨 2 는 85점 이상이면 위반이 있어도 자동 승인', () => {
    expect(shouldAutoApprove(2, pass(85))).toBe(true);
    expect(shouldAutoApprove(2, pass(84.9))).toBe(false);
    expect(shouldAutoApprove(2, pass(90, [{ code: 'WARN' }]))).toBe(true);
  });

  it('레벨 3 은 QC PASS 전건 자동', () => {
    expect(shouldAutoApprove(3, pass(80))).toBe(true);
  });

  it('BLOCKED·FAIL 은 어떤 레벨에서도 자동 승인되지 않는다', () => {
    for (const level of [0, 1, 2, 3]) {
      expect(shouldAutoApprove(level, { verdict: 'BLOCKED', totalScore: 100, violations: [] })).toBe(false);
      expect(shouldAutoApprove(level, { verdict: 'FAIL', totalScore: 79, violations: [] })).toBe(false);
    }
  });

  it('정의되지 않은 레벨은 가장 보수적인 레벨 0 규칙을 따른다', () => {
    expect(shouldAutoApprove(99, pass(100))).toBe(false);
    expect(APPROVAL_RULE[0](pass(100))).toBe(false);
  });

  describe('§6.2 4-eyes 원칙', () => {
    it('오더를 만든 본인은 자기 콘텐츠를 승인할 수 없다', () => {
      expect(violatesFourEyes({ orderRequestedBy: 'u1', actorId: 'u1', actorRole: 'REVIEWER' })).toBe(true);
    });
    it('다른 사람은 승인할 수 있다', () => {
      expect(violatesFourEyes({ orderRequestedBy: 'u1', actorId: 'u2', actorRole: 'REVIEWER' })).toBe(false);
    });
    it('SUPER_ROOT 만 예외다', () => {
      expect(violatesFourEyes({ orderRequestedBy: 'u1', actorId: 'u1', actorRole: 'SUPER_ROOT' })).toBe(false);
    });
  });
});
