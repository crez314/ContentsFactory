import { WEIGHTS, fitScore, passesExclude } from '@cf/domain';

const base = {
  attributes: { outfit: 'casual', angle: 'front', background: 'outdoor_street' },
  qualityGrade: 'A' as const,
  shotAt: new Date().toISOString().slice(0, 10),
  licenseValidUntil: new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10),
  usageCount: 0,
};
const NOW = new Date('2026-09-01T00:00:00Z');

describe('§4.3 선별 적합도', () => {
  it('가중치 합은 1이다', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('조건을 전부 만족하는 신품 A등급은 만점에 가깝다', () => {
    const { score } = fitScore(
      { ...base, shotAt: NOW.toISOString().slice(0, 10) },
      { include: { outfit: ['casual'], angle: ['front'] } },
      NOW,
    );
    expect(score).toBeGreaterThan(95);
  });

  it('속성이 하나도 맞지 않으면 attrMatch 기여분(0.45)만큼 낮아진다', () => {
    const matched = fitScore(base, { include: { outfit: ['casual'] } }, NOW);
    const unmatched = fitScore(base, { include: { outfit: ['formal'] } }, NOW);
    expect(matched.score - unmatched.score).toBeCloseTo(45, 0);
  });

  it('품질 등급이 낮을수록 점수가 낮다', () => {
    const a = fitScore({ ...base, qualityGrade: 'A' }, {}, NOW).score;
    const b = fitScore({ ...base, qualityGrade: 'B' }, {}, NOW).score;
    const c = fitScore({ ...base, qualityGrade: 'C' }, {}, NOW).score;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('반감기 180일 — 180일 전 촬영은 freshness 가 절반이다', () => {
    const old = fitScore(
      { ...base, shotAt: new Date(NOW.getTime() - 180 * 86_400_000).toISOString().slice(0, 10) },
      {}, NOW,
    );
    expect(old.breakdown.freshness).toBeCloseTo(0.5, 2);
  });

  it('사용 편중 억제 — 많이 쓴 자산일수록 점수가 낮아진다', () => {
    const fresh = fitScore({ ...base, usageCount: 0 }, {}, NOW).score;
    const used = fitScore({ ...base, usageCount: 20 }, {}, NOW).score;
    expect(used).toBeLessThan(fresh);
    // 이 감점이 없으면 소수 자산만 반복 사용되어 콘텐츠가 획일화된다.
    expect(fitScore({ ...base, usageCount: 0 }, {}, NOW).breakdown.usageBalance).toBe(1);
  });

  it('라이선스 만료가 임박하면 licenseMargin 이 낮다', () => {
    const soon = fitScore(
      { ...base, licenseValidUntil: new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10) },
      {}, NOW,
    );
    expect(soon.breakdown.licenseMargin).toBeLessThan(0.05);
  });

  it('점수는 0~100 범위를 벗어나지 않는다', () => {
    const worst = fitScore(
      { attributes: {}, qualityGrade: 'C', shotAt: '2000-01-01', licenseValidUntil: '2000-01-01', usageCount: 9999 },
      { include: { outfit: ['formal'] } }, NOW,
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('exclude 에 걸린 자산은 후보에서 제외된다', () => {
    expect(passesExclude({ angle: 'back' }, { exclude: { angle: ['back'] } })).toBe(false);
    expect(passesExclude({ angle: 'front' }, { exclude: { angle: ['back'] } })).toBe(true);
  });
});
