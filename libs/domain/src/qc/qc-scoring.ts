import { round2 } from '@cf/common';
import type { QcAreaScores, QcViolation } from '../types/json-shapes';
import type { QcVerdict } from '../types/enums';

/** §4.6 검수 영역 가중치 */
export const QC_WEIGHTS = {
  quality: 0.30,
  identity: 0.25,
  brand: 0.15,
  policy: 0.10,
  copyright: 0.10,
  aiRisk: 0.10,
} as const;

export type QcArea = keyof typeof QC_WEIGHTS;
export const QC_AREAS = Object.keys(QC_WEIGHTS) as QcArea[];

/** 위반이 하나라도 있으면 점수와 무관하게 BLOCKED. 재시도하지 않는다. */
export const HARD_BLOCK: readonly QcArea[] = ['policy', 'copyright'];

export const DEFAULT_PASS_SCORE = 80;

export const QC_AREA_LABELS_KO: Record<QcArea, string> = {
  quality: '품질',
  identity: '동일성',
  brand: '브랜드',
  policy: '정책',
  copyright: '저작권',
  aiRisk: 'AI 리스크',
};

export interface AreaCheck {
  score: number;             // 0~100
  violations: QcViolation[];
}
export type ChecksByArea = Record<QcArea, AreaCheck>;

export interface QcEvaluation {
  verdict: QcVerdict;
  totalScore: number;
  areaScores: QcAreaScores;
  violations: QcViolation[];
  retryTarget: QcArea | null;
}

export function mapScores(checks: ChecksByArea): QcAreaScores {
  return {
    quality: round2(checks.quality.score),
    identity: round2(checks.identity.score),
    brand: round2(checks.brand.score),
    policy: round2(checks.policy.score),
    copyright: round2(checks.copyright.score),
    aiRisk: round2(checks.aiRisk.score),
  };
}

/**
 * §4.6 판정 규칙.
 * 1) HARD_BLOCK 영역에 위반이 있으면 즉시 BLOCKED (총점 0).
 * 2) 그 외에는 가중합이 PASS_SCORE 이상이면 PASS.
 * 3) FAIL 이면 최저 점수 영역을 retryTarget 으로 지정해 그 모듈만 재실행한다.
 */
export function evaluateQc(checks: ChecksByArea, passScore = DEFAULT_PASS_SCORE): QcEvaluation {
  for (const area of HARD_BLOCK) {
    if (checks[area].violations.length) {
      return {
        verdict: 'BLOCKED',
        totalScore: 0,
        areaScores: mapScores(checks),
        violations: checks[area].violations,
        retryTarget: null,
      };
    }
  }

  const total = QC_AREAS.reduce((sum, area) => sum + QC_WEIGHTS[area] * checks[area].score, 0);
  const worst = QC_AREAS.reduce((a, b) => (checks[a].score <= checks[b].score ? a : b));
  const pass = total >= passScore;

  return {
    verdict: pass ? 'PASS' : 'FAIL',
    totalScore: round2(total),
    areaScores: mapScores(checks),
    violations: QC_AREAS.flatMap((a) => checks[a].violations),
    retryTarget: pass ? null : worst,
  };
}

/**
 * §3.3 retryTarget → 재실행할 Task 종류.
 * identity/quality 는 생성 단계로, brand/aiRisk 는 렌더 단계로 되돌린다.
 */
export function moduleForRetryTarget(
  target: string | null,
  outputType: 'IMAGE' | 'VIDEO' | 'BOTH',
): 'GENERATE_IMAGE' | 'GENERATE_VIDEO' | 'RENDER' {
  const isVideo = outputType === 'VIDEO';
  switch (target) {
    case 'identity':
    case 'quality':
      return isVideo ? 'GENERATE_VIDEO' : 'GENERATE_IMAGE';
    case 'brand':
    case 'aiRisk':
      return isVideo ? 'RENDER' : 'GENERATE_IMAGE';
    default:
      return isVideo ? 'GENERATE_VIDEO' : 'GENERATE_IMAGE';
  }
}
