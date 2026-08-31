import {
  DEFAULT_PASS_SCORE, HARD_BLOCK, QC_AREAS, QC_WEIGHTS,
  evaluateQc, moduleForRetryTarget, type ChecksByArea,
} from '@cf/domain';

const checks = (scores: Partial<Record<string, number>>, violations: Partial<Record<string, unknown[]>> = {}): ChecksByArea =>
  Object.fromEntries(
    QC_AREAS.map((a) => [a, { score: scores[a] ?? 100, violations: (violations[a] ?? []) as never[] }]),
  ) as unknown as ChecksByArea;

describe('§4.6 QC 판정', () => {
  it('가중치 합은 1이다', () => {
    expect(Object.values(QC_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('전 영역 만점이면 PASS 100점', () => {
    const r = evaluateQc(checks({}));
    expect(r.verdict).toBe('PASS');
    expect(r.totalScore).toBe(100);
    expect(r.retryTarget).toBeNull();
  });

  it('가중합이 기준 미만이면 FAIL', () => {
    const r = evaluateQc(checks({ quality: 40, identity: 50 }));
    // 0.30*40 + 0.25*50 + 나머지 100 = 12 + 12.5 + 45 = 69.5
    expect(r.totalScore).toBeCloseTo(69.5, 2);
    expect(r.verdict).toBe('FAIL');
  });

  it('FAIL 이면 최저 점수 영역을 retryTarget 으로 지목한다', () => {
    const r = evaluateQc(checks({ quality: 60, identity: 30, brand: 70 }));
    expect(r.verdict).toBe('FAIL');
    expect(r.retryTarget).toBe('identity');
  });

  it.each(HARD_BLOCK)('%s 영역 위반은 점수와 무관하게 BLOCKED', (area) => {
    const r = evaluateQc(checks({}, { [area]: [{ area, code: 'X', message: 'x' }] }));
    expect(r.verdict).toBe('BLOCKED');
    expect(r.totalScore).toBe(0);
    expect(r.retryTarget).toBeNull();
  });

  it('BLOCKED 는 다른 영역이 만점이어도 뒤집히지 않는다', () => {
    const r = evaluateQc(checks({ quality: 100, identity: 100 }, { copyright: [{ code: 'LICENSE' }] }));
    expect(r.verdict).toBe('BLOCKED');
  });

  it('기준 점수는 설정으로 바꿀 수 있다', () => {
    const c = checks({ quality: 40, identity: 50 }); // 69.5
    expect(evaluateQc(c, DEFAULT_PASS_SCORE).verdict).toBe('FAIL');
    expect(evaluateQc(c, 60).verdict).toBe('PASS');
  });

  it('retryTarget 은 대응 모듈로 매핑된다', () => {
    expect(moduleForRetryTarget('identity', 'VIDEO')).toBe('GENERATE_VIDEO');
    expect(moduleForRetryTarget('identity', 'IMAGE')).toBe('GENERATE_IMAGE');
    expect(moduleForRetryTarget('brand', 'VIDEO')).toBe('RENDER');
    expect(moduleForRetryTarget('brand', 'IMAGE')).toBe('GENERATE_IMAGE');
    expect(moduleForRetryTarget(null, 'IMAGE')).toBe('GENERATE_IMAGE');
  });
});
