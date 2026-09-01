import { daysSince, round2 } from '@cf/common';
import type { AssetAttributes, AssetFilter } from '../types/json-shapes';
import type { QualityGrade } from '../types/enums';

/**
 * §4.3 Selection Module (명세 v1.1).
 *
 * 설계 원칙 — **라이선스·정책 조건은 점수에 반영하지 않고 후보 진입 단계에서 배제한다.**
 * 점수로 처리하면 다른 항목의 높은 점수로 상쇄되어 계약 범위를 벗어난 자산이 통과할 수 있고,
 * 이 미탐은 법적 리스크로 직결되므로 상쇄 대상이 될 수 없다.
 *
 * v1.0 에 있던 licenseMargin 가중치(0.10)는 그래서 제거되었다.
 */
export const WEIGHTS = {
  attrMatch: 0.50,
  quality: 0.22,
  freshness: 0.16,
  usageBalance: 0.12,
} as const;

/** 이 점수 미만이면 순위가 있어도 커버리지 부족으로 처리한다. */
export const MIN_FIT = 45;

const QUALITY_SCORE: Record<QualityGrade, number> = { A: 1.0, B: 0.7, C: 0.4 };
export const FRESH_HALF_LIFE_DAYS = 180;

/** §4.3 2차 가공 허용 수준. 라이선스가 오더 요구 수준 이상이어야 한다. */
export const DERIVATIVE_LEVEL = {
  NONE: 0,        // 불허
  EDIT: 1,        // 단순 편집 (크롭·색보정)
  COMPOSITE: 2,   // 합성·변형
  GENERATIVE: 3,  // AI 생성물 제작 허용
} as const;
export type DerivativeLevel = 0 | 1 | 2 | 3;

export const DERIVATIVE_LEVEL_LABELS_KO: Record<number, string> = {
  0: '불허',
  1: '단순 편집',
  2: '합성·변형',
  3: 'AI 생성 허용',
};

/** eligible() 이 보는 라이선스 사실관계 */
export interface LicenseFacts {
  allowedChannels: string[];   // 소문자 플랫폼 키
  allowedRegions: string[];    // 대문자 ISO 국가코드
  derivativeLevel: number;
  validFrom: string;           // YYYY-MM-DD
  validUntil: string;
}

export interface EligibilityCandidate {
  attributes: AssetAttributes;
  qualityGrade: QualityGrade;
  licenses: LicenseFacts[];
}

/** 오더 쪽 사실관계. 채널이 여러 개면 전부 만족해야 한다. */
export interface EligibilityRequirement {
  /** [{ platform: 'youtube', region: 'KR' }, …] — 오더의 대상 채널 전부 */
  channels: Array<{ platform: string; region: string }>;
  /** 게시 예정일 (YYYY-MM-DD). 라이선스 유효기간을 이 날짜로 판정한다. */
  publishDate: string;
  /** 이 오더 수행에 필요한 최소 2차 가공 수준 */
  derivativeLevel: number;
  /** 허용 품질 등급. 비어 있으면 전 등급 허용 */
  allowedGrades: QualityGrade[];
  assetFilter: AssetFilter;
}

export type IneligibleReason =
  | 'LICENSE_CHANNEL'
  | 'LICENSE_REGION'
  | 'LICENSE_PERIOD'
  | 'DERIVATIVE_LEVEL'
  | 'QUALITY_GRADE'
  | 'EXCLUDED_ATTRIBUTE';

export interface EligibilityResult {
  ok: boolean;
  reasons: IneligibleReason[];
}

/**
 * 라이선스·정책 사전 필터. 미통과 자산은 점수 계산 자체를 하지 않는다.
 *
 * 오더가 여러 채널을 겨냥하면 **모든 채널에서 사용 가능해야** 통과한다.
 * Selection 은 Blueprint 팬아웃 이전에 오더 단위로 한 번 돌기 때문이며,
 * 한 채널이라도 불가한 자산을 통과시키면 그 채널의 게시가 위반이 된다.
 */
export function eligibility(
  asset: EligibilityCandidate,
  req: EligibilityRequirement,
): EligibilityResult {
  const reasons: IneligibleReason[] = [];

  if (req.allowedGrades.length && !req.allowedGrades.includes(asset.qualityGrade)) {
    reasons.push('QUALITY_GRADE');
  }
  if (!passesExclude(asset.attributes, req.assetFilter)) {
    reasons.push('EXCLUDED_ATTRIBUTE');
  }

  // 채널별로, 그 채널을 커버하는 라이선스가 하나라도 있어야 한다.
  for (const ch of req.channels) {
    const platform = ch.platform.toLowerCase();
    const region = ch.region.toUpperCase();

    const byChannel = asset.licenses.filter((l) => l.allowedChannels.includes(platform));
    if (!byChannel.length) { pushOnce(reasons, 'LICENSE_CHANNEL'); continue; }

    const byRegion = byChannel.filter((l) => l.allowedRegions.includes(region));
    if (!byRegion.length) { pushOnce(reasons, 'LICENSE_REGION'); continue; }

    const inPeriod = byRegion.filter(
      (l) => l.validFrom <= req.publishDate && req.publishDate <= l.validUntil,
    );
    if (!inPeriod.length) { pushOnce(reasons, 'LICENSE_PERIOD'); continue; }

    if (!inPeriod.some((l) => l.derivativeLevel >= req.derivativeLevel)) {
      pushOnce(reasons, 'DERIVATIVE_LEVEL');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export const isEligible = (a: EligibilityCandidate, r: EligibilityRequirement): boolean =>
  eligibility(a, r).ok;

export interface FitScoreInput {
  attributes: AssetAttributes;
  qualityGrade: QualityGrade;
  shotAt: string | Date | null;
  /** 이 자산이 지금까지 콘텐츠에 사용된 횟수 (asset_usages 집계) */
  usageCount: number;
}

export interface FitScoreBreakdown {
  attrMatch: number;
  quality: number;
  freshness: number;
  usageBalance: number;
  matched: Record<string, string[]>;
}

export interface FitScoreResult {
  score: number;
  breakdown: FitScoreBreakdown;
}

/**
 * 적합도 0~100. 사전 필터를 통과한 자산끼리의 **상대 비교**만 담당한다.
 *
 * usageBalance 가 이 모듈의 실무적 요점이다 (§4.3).
 * 이것이 없으면 점수가 높은 소수 자산만 반복 사용되어 콘텐츠가 획일화된다.
 */
export function fitScore(input: FitScoreInput, filter: AssetFilter, now = new Date()): FitScoreResult {
  // 1) 속성 일치도 — 오더가 지정한 속성과 자산 속성의 일치 비율
  const wanted = filter.include ?? {};
  const keys = Object.keys(wanted);
  const matched: Record<string, string[]> = {};
  let matchedCount = 0;
  for (const key of keys) {
    const assetValue = input.attributes[key];
    if (assetValue && wanted[key].includes(assetValue)) {
      matched[key] = [assetValue];
      matchedCount += 1;
    }
  }
  const attrMatch = keys.length ? matchedCount / keys.length : 1;

  // 2) 품질 등급
  const quality = QUALITY_SCORE[input.qualityGrade] ?? 0.4;

  // 3) 촬영 신선도 — 최근 촬영일수록 가점 (반감기 180일)
  const freshness = Math.pow(0.5, daysSince(input.shotAt, now) / FRESH_HALF_LIFE_DAYS);

  // 4) 사용 편중 억제 — 이미 많이 쓴 자산은 감점
  const usageBalance = 1 / (1 + Math.log1p(Math.max(0, input.usageCount)));

  const score = round2(
    100 *
      (WEIGHTS.attrMatch * attrMatch +
        WEIGHTS.quality * quality +
        WEIGHTS.freshness * freshness +
        WEIGHTS.usageBalance * usageBalance),
  );

  return {
    score,
    breakdown: {
      attrMatch: round2(attrMatch),
      quality: round2(quality),
      freshness: round2(freshness),
      usageBalance: round2(usageBalance),
      matched,
    },
  };
}

/** exclude 필터는 점수가 아니라 후보 자체에서 제외한다. */
export function passesExclude(attributes: AssetAttributes, filter: AssetFilter): boolean {
  const exclude = filter.exclude ?? {};
  for (const [key, values] of Object.entries(exclude)) {
    const v = attributes[key];
    if (v && values.includes(v)) return false;
  }
  return true;
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** 동일 촬영 세션 판별 키. 촬영일을 세션의 대용치로 쓴다. */
  sessionKey: string;
}

/**
 * §4.3 동일 촬영 세션 편중 완화 후 상위 k.
 *
 * 명세는 "동일 촬영 세션"이라고만 하고 세션 식별자를 정의하지 않는다.
 * 스키마에 세션 컬럼이 없으므로 촬영일(shot_at)을 대용치로 쓴다.
 * 같은 날 찍은 컷이 한 세션이라는 가정이며, 세션 ID 가 생기면 sessionKey 만 바꾸면 된다.
 *
 * 라운드로빈으로 세션을 돌며 한 장씩 뽑아, 한 세션이 결과를 독식하지 못하게 한다.
 * 점수 순서는 세션 안에서 유지된다.
 */
export function diversify<T>(ranked: Array<Ranked<T>>, k: number): Array<Ranked<T>> {
  if (k <= 0) return [];
  if (ranked.length <= k) return [...ranked];

  const bySession = new Map<string, Array<Ranked<T>>>();
  for (const r of ranked) {
    const list = bySession.get(r.sessionKey) ?? [];
    list.push(r);
    bySession.set(r.sessionKey, list);
  }

  // 세션 대표(최고점) 순으로 세션을 정렬해 좋은 세션이 먼저 오게 한다.
  const sessions = [...bySession.values()].sort((a, b) => b[0].score - a[0].score);

  const out: Array<Ranked<T>> = [];
  for (let round = 0; out.length < k; round++) {
    let progressed = false;
    for (const session of sessions) {
      if (out.length >= k) break;
      const pick = session[round];
      if (!pick) continue;
      out.push(pick);
      progressed = true;
    }
    if (!progressed) break; // 모든 세션이 소진됨
  }
  return out;
}

/** 같은 사유를 채널 수만큼 반복해 담지 않는다. */
function pushOnce<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}
