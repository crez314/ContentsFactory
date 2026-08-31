import { estimateCost, sceneCount, type UnitPricing } from '@cf/domain';

const pricing: UnitPricing = {
  imageKrw: 100, videoSceneKrw: 1000, voiceKrw: 50, musicKrw: 50, renderKrw: 50, embeddingKrw: 10,
};

describe('§4.2 비용 추정', () => {
  it('Scene 수는 총 길이를 기본 Scene 길이로 나눈 값이다', () => {
    expect(sceneCount(30)).toBe(8);   // 30초 / 4초
    expect(sceneCount(12)).toBe(3);
    expect(sceneCount(undefined)).toBe(8);
  });

  it('콘텐츠 수는 수량 × 채널 수', () => {
    const e = estimateCost(
      { outputType: 'IMAGE', quantity: 3, channelCount: 2, spec: {} }, pricing,
    );
    expect(e.contentCount).toBe(6);
    expect(e.totalKrw).toBe(e.perContentKrw * 6);
  });

  it('영상이 이미지보다 비싸다', () => {
    const img = estimateCost({ outputType: 'IMAGE', quantity: 1, channelCount: 1, spec: {} }, pricing);
    const vid = estimateCost({ outputType: 'VIDEO', quantity: 1, channelCount: 1, spec: { durationSec: 30 } }, pricing);
    expect(vid.perContentKrw).toBeGreaterThan(img.perContentKrw);
  });

  it('BOTH 는 이미지 + 영상 비용을 모두 포함한다', () => {
    const spec = { durationSec: 12 };
    const img = estimateCost({ outputType: 'IMAGE', quantity: 1, channelCount: 1, spec }, pricing);
    const vid = estimateCost({ outputType: 'VIDEO', quantity: 1, channelCount: 1, spec }, pricing);
    const both = estimateCost({ outputType: 'BOTH', quantity: 1, channelCount: 1, spec }, pricing);
    expect(both.perContentKrw).toBe(img.perContentKrw + vid.perContentKrw);
  });

  it('영상이 길수록 비싸다', () => {
    const short = estimateCost({ outputType: 'VIDEO', quantity: 1, channelCount: 1, spec: { durationSec: 12 } }, pricing);
    const long = estimateCost({ outputType: 'VIDEO', quantity: 1, channelCount: 1, spec: { durationSec: 60 } }, pricing);
    expect(long.perContentKrw).toBeGreaterThan(short.perContentKrw);
  });

  it('Identity 재시도 여유분이 반영된다', () => {
    const noRetry = estimateCost(
      { outputType: 'IMAGE', quantity: 1, channelCount: 1, spec: {}, identityRetryFactor: 1 }, pricing);
    const withRetry = estimateCost(
      { outputType: 'IMAGE', quantity: 1, channelCount: 1, spec: {}, identityRetryFactor: 1.3 }, pricing);
    expect(withRetry.perContentKrw).toBeGreaterThan(noRetry.perContentKrw);
  });
});
