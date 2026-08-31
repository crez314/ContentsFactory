import type { UnitPricing } from '@cf/domain';

/**
 * §4.2 어댑터별 단가표.
 * 운영에서는 설정(model_pricing)으로 관리하지만, V1 로컬에서는 Mock 어댑터 단가와 맞춘다.
 * 실제 비용과의 오차는 cost_logs 로 사후 보정한다.
 */
export const MODEL_PRICING: UnitPricing = {
  imageKrw: 120,
  videoSceneKrw: 900,
  voiceKrw: 60,
  musicKrw: 80,
  renderKrw: 40,
  embeddingKrw: 5,
};
