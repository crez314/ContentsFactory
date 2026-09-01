import { MIN_FIT, WEIGHTS, diversify, eligibility, fitScore, passesExclude, type Ranked } from '@cf/domain';

const NOW = new Date('2026-09-01T00:00:00Z');
const base = {
  attributes: { outfit: 'casual', angle: 'front', background: 'outdoor_street' },
  qualityGrade: 'A' as const,
  shotAt: NOW.toISOString().slice(0, 10),
  usageCount: 0,
};

describe('§4.3 선별 적합도 (v1.1)', () => {
  it('가중치 합은 1이다', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('라이선스는 점수 항목이 아니다 — 사전 필터로 옮겨졌다', () => {
    // v1.0 의 licenseMargin 이 사라졌는지 확인한다.
    // 점수로 두면 다른 항목의 높은 점수로 상쇄되어 계약 범위 밖 자산이 통과할 수 있다.
    expect(WEIGHTS).not.toHaveProperty('licenseMargin');
    expect(Object.keys(WEIGHTS).sort()).toEqual(['attrMatch', 'freshness', 'quality', 'usageBalance']);
  });

  it('조건을 전부 만족하는 신품 A등급은 만점에 가깝다', () => {
    const { score } = fitScore(base, { include: { outfit: ['casual'], angle: ['front'] } }, NOW);
    expect(score).toBeGreaterThan(95);
  });

  it('속성이 하나도 맞지 않으면 attrMatch 기여분(0.50)만큼 낮아진다', () => {
    const matched = fitScore(base, { include: { outfit: ['casual'] } }, NOW);
    const unmatched = fitScore(base, { include: { outfit: ['formal'] } }, NOW);
    expect(matched.score - unmatched.score).toBeCloseTo(50, 0);
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
    expect(fitScore({ ...base, usageCount: 0 }, {}, NOW).breakdown.usageBalance).toBe(1);
  });

  it('점수는 0~100 범위를 벗어나지 않는다', () => {
    const worst = fitScore(
      { attributes: {}, qualityGrade: 'C', shotAt: '2000-01-01', usageCount: 9999 },
      { include: { outfit: ['formal'] } }, NOW,
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('MIN_FIT 미만은 커버리지 부족으로 처리된다', () => {
    const poor = fitScore(
      { attributes: { outfit: 'formal' }, qualityGrade: 'C', shotAt: '2020-01-01', usageCount: 50 },
      { include: { outfit: ['casual'], angle: ['front'], background: ['chroma'] } }, NOW,
    );
    expect(poor.score).toBeLessThan(MIN_FIT);
  });

  it('exclude 에 걸린 자산은 후보에서 제외된다', () => {
    expect(passesExclude({ angle: 'back' }, { exclude: { angle: ['back'] } })).toBe(false);
    expect(passesExclude({ angle: 'front' }, { exclude: { angle: ['back'] } })).toBe(true);
  });
});

describe('§4.3 사전 필터 eligibility()', () => {
  const license = {
    allowedChannels: ['youtube', 'instagram'],
    allowedRegions: ['KR'],
    derivativeLevel: 3,
    validFrom: '2026-01-01',
    validUntil: '2027-01-01',
  };
  const asset = { attributes: { outfit: 'casual' }, qualityGrade: 'A' as const, licenses: [license] };
  const req = {
    channels: [{ platform: 'youtube', region: 'KR' }],
    publishDate: '2026-09-01',
    derivativeLevel: 3,
    allowedGrades: [] as never[],
    assetFilter: {},
  };

  it('모든 조건을 만족하면 통과한다', () => {
    expect(eligibility(asset, req).ok).toBe(true);
  });

  it('채널이 허용되지 않으면 배제한다', () => {
    const r = eligibility(asset, { ...req, channels: [{ platform: 'tiktok', region: 'KR' }] });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('LICENSE_CHANNEL');
  });

  it('지역이 허용되지 않으면 배제한다', () => {
    const r = eligibility(asset, { ...req, channels: [{ platform: 'youtube', region: 'JP' }] });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('LICENSE_REGION');
  });

  it('게시 예정일이 유효기간 밖이면 배제한다', () => {
    expect(eligibility(asset, { ...req, publishDate: '2027-06-01' }).reasons).toContain('LICENSE_PERIOD');
    expect(eligibility(asset, { ...req, publishDate: '2025-06-01' }).reasons).toContain('LICENSE_PERIOD');
  });

  it('2차 가공 허용 수준이 모자라면 배제한다', () => {
    const limited = { ...asset, licenses: [{ ...license, derivativeLevel: 1 }] };
    const r = eligibility(limited, req);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('DERIVATIVE_LEVEL');
  });

  it('오더가 허용하지 않는 품질 등급은 배제한다', () => {
    const r = eligibility({ ...asset, qualityGrade: 'C' }, { ...req, allowedGrades: ['A', 'B'] as never });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('QUALITY_GRADE');
  });

  it('여러 채널을 겨냥하면 전부 만족해야 한다', () => {
    // 한 채널이라도 불가한 자산을 통과시키면 그 채널의 게시가 위반이 된다.
    const r = eligibility(asset, {
      ...req,
      channels: [{ platform: 'youtube', region: 'KR' }, { platform: 'youtube', region: 'JP' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('LICENSE_REGION');
  });

  it('라이선스가 여러 건이면 조건을 만족하는 것이 하나만 있어도 된다', () => {
    const multi = {
      ...asset,
      licenses: [
        { ...license, allowedChannels: ['tiktok'] },
        { ...license, allowedChannels: ['youtube'] },
      ],
    };
    expect(eligibility(multi, req).ok).toBe(true);
  });

  it('미탐이 오탐보다 위험하다 — 조건 불충족은 어떤 경우에도 통과하지 않는다', () => {
    const expired = { ...asset, licenses: [{ ...license, validUntil: '2026-08-01' }] };
    expect(eligibility(expired, req).ok).toBe(false);
  });
});

describe('§4.3 diversify() — 동일 촬영 세션 편중 완화', () => {
  const mk = (id: string, score: number, sessionKey: string): Ranked<string> => ({ item: id, score, sessionKey });

  it('한 세션이 결과를 독식하지 못한다', () => {
    const ranked = [
      mk('a1', 99, 'day-1'), mk('a2', 98, 'day-1'), mk('a3', 97, 'day-1'), mk('a4', 96, 'day-1'),
      mk('b1', 90, 'day-2'), mk('b2', 89, 'day-2'),
      mk('c1', 80, 'day-3'),
    ];
    const picked = diversify(ranked, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.sessionKey)).size).toBe(3);
  });

  it('세션 안에서는 점수 순서가 유지된다', () => {
    const ranked = [
      mk('a1', 99, 'day-1'), mk('a2', 98, 'day-1'),
      mk('b1', 90, 'day-2'), mk('b2', 89, 'day-2'),
    ];
    const picked = diversify(ranked, 4).filter((p) => p.sessionKey === 'day-1');
    expect(picked.map((p) => p.item)).toEqual(['a1', 'a2']);
  });

  it('세션이 하나뿐이면 점수 순으로 그대로 뽑는다', () => {
    const ranked = [mk('a1', 99, 'day-1'), mk('a2', 98, 'day-1'), mk('a3', 97, 'day-1')];
    expect(diversify(ranked, 2).map((p) => p.item)).toEqual(['a1', 'a2']);
  });

  it('요청 수가 후보보다 많으면 전부 돌려준다', () => {
    const ranked = [mk('a1', 99, 'day-1'), mk('b1', 90, 'day-2')];
    expect(diversify(ranked, 10)).toHaveLength(2);
  });

  it('k 가 0 이하면 빈 배열', () => {
    expect(diversify([mk('a1', 99, 'day-1')], 0)).toEqual([]);
  });

  it('좋은 세션이 먼저 온다', () => {
    const ranked = [
      mk('hi', 95, 'good'), mk('hi2', 94, 'good'),
      mk('lo', 60, 'weak'), mk('lo2', 59, 'weak'),
    ];
    expect(diversify(ranked, 2)[0].sessionKey).toBe('good');
  });
});
