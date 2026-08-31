import type { OrderSpec, OutputType } from '../types';

/**
 * §4.2 비용 추정.
 * 오더의 산출물 유형·수량·길이로 예상 호출 수를 계산하고 어댑터 단가표를 곱한다.
 * 실제 비용과의 오차는 cost_logs 로 사후 보정한다.
 */
export interface UnitPricing {
  imageKrw: number;      // 이미지 1장
  videoSceneKrw: number; // 영상 Scene 1개
  voiceKrw: number;      // 콘텐츠 1건 음성
  musicKrw: number;      // 콘텐츠 1건 BGM
  renderKrw: number;     // 콘텐츠 1건 렌더
  embeddingKrw: number;  // 임베딩 1회
}

export const SCENE_MIN_MS = 3000;
export const SCENE_MAX_MS = 6000;
export const DEFAULT_SCENE_MS = 4000;

export function sceneCount(durationSec: number | undefined): number {
  const totalMs = (durationSec ?? 30) * 1000;
  return Math.max(1, Math.round(totalMs / DEFAULT_SCENE_MS));
}

export interface CostEstimateInput {
  outputType: OutputType;
  quantity: number;
  channelCount: number;
  spec: OrderSpec;
  /** Identity 재시도 여유분. §4.5 최대 3회이므로 평균 1.3회로 가정한다. */
  identityRetryFactor?: number;
}

export interface CostEstimate {
  totalKrw: number;
  perContentKrw: number;
  contentCount: number;
  breakdown: Record<string, number>;
}

export function estimateCost(input: CostEstimateInput, pricing: UnitPricing): CostEstimate {
  const contentCount = Math.max(1, input.quantity) * Math.max(1, input.channelCount);
  const retryFactor = input.identityRetryFactor ?? 1.3;
  const breakdown: Record<string, number> = {};

  let perContent = 0;

  const wantsImage = input.outputType === 'IMAGE' || input.outputType === 'BOTH';
  const wantsVideo = input.outputType === 'VIDEO' || input.outputType === 'BOTH';

  if (wantsImage) {
    const image = pricing.imageKrw * retryFactor;
    const embed = pricing.embeddingKrw * retryFactor;
    breakdown.image = image;
    breakdown.embedding = (breakdown.embedding ?? 0) + embed;
    perContent += image + embed;
  }

  if (wantsVideo) {
    const scenes = sceneCount(input.spec.durationSec);
    const video = pricing.videoSceneKrw * scenes * retryFactor;
    const embed = pricing.embeddingKrw * scenes * retryFactor;
    breakdown.videoScenes = video;
    breakdown.embedding = (breakdown.embedding ?? 0) + embed;
    breakdown.voice = pricing.voiceKrw;
    breakdown.music = pricing.musicKrw;
    breakdown.render = pricing.renderKrw;
    perContent += video + embed + pricing.voiceKrw + pricing.musicKrw + pricing.renderKrw;
  }

  const perContentKrw = Math.round(perContent);
  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k] * contentCount);

  return {
    totalKrw: perContentKrw * contentCount,
    perContentKrw,
    contentCount,
    breakdown,
  };
}
