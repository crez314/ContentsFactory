import { daysSince, daysUntil, round2 } from '@cf/common';
import type { AssetAttributes, AssetFilter } from '../types/json-shapes';
import type { QualityGrade } from '../types/enums';

/** §4.3 적합도 가중치 */
export const WEIGHTS = {
  attrMatch: 0.45,
  quality: 0.20,
  freshness: 0.15,
  licenseMargin: 0.10,
  usageBalance: 0.10,
} as const;

const QUALITY_SCORE: Record<QualityGrade, number> = { A: 1.0, B: 0.7, C: 0.4 };
const FRESHNESS_HALF_LIFE_DAYS = 180;

export interface FitScoreInput {
  attributes: AssetAttributes;
  qualityGrade: QualityGrade;
  shotAt: string | Date | null;
  licenseValidUntil: string | Date | null;
  /** 이 자산이 지금까지 콘텐츠에 사용된 횟수 (asset_usages 집계) */
  usageCount: number;
}

export interface FitScoreBreakdown {
  attrMatch: number;
  quality: number;
  freshness: number;
  licenseMargin: number;
  usageBalance: number;
  matched: Record<string, string[]>;
}

export interface FitScoreResult {
  score: number;
  breakdown: FitScoreBreakdown;
}

/**
 * 오더 조건과 자산의 적합도를 0~100 으로 환산한다.
 *
 * 5번 usageBalance 가 이 모듈의 실무적 요점이다 (§4.3).
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
  const freshness = Math.pow(0.5, daysSince(input.shotAt, now) / FRESHNESS_HALF_LIFE_DAYS);

  // 4) 라이선스 여유 — 만료가 멀수록 가점
  const remain = daysUntil(input.licenseValidUntil, now);
  const licenseMargin = Math.max(0, Math.min(remain / 365, 1));

  // 5) 사용 편중 억제 — 이미 많이 쓴 자산은 감점
  const usageBalance = 1 / (1 + Math.log1p(Math.max(0, input.usageCount)));

  const score = round2(
    100 *
      (WEIGHTS.attrMatch * attrMatch +
        WEIGHTS.quality * quality +
        WEIGHTS.freshness * freshness +
        WEIGHTS.licenseMargin * licenseMargin +
        WEIGHTS.usageBalance * usageBalance),
  );

  return {
    score,
    breakdown: {
      attrMatch: round2(attrMatch),
      quality: round2(quality),
      freshness: round2(freshness),
      licenseMargin: round2(licenseMargin),
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
