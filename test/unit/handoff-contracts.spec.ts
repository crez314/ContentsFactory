import {
  BlueprintResult, GenerationResult, JobEnvelope, PublishResult, QcHandoff, RenderResult, SelectionResult,
} from '@cf/queue';

const UUID = '0193f3b0-1111-4222-8333-444444444444';

/**
 * §12 계약 테스트.
 * Handoff 스키마가 바뀌면 여기가 먼저 깨진다.
 */
describe('§3.2 Job 계약', () => {
  it('JobEnvelope 은 필수 필드를 요구한다', () => {
    const ok = {
      taskId: UUID, kind: 'QC', attempt: 1, idempotencyKey: 'QC:x:-:1',
      budgetCapKrw: 0, deadline: new Date().toISOString(), payload: {},
    };
    expect(() => JobEnvelope.parse(ok)).not.toThrow();
    expect(() => JobEnvelope.parse({ ...ok, taskId: 'not-a-uuid' })).toThrow();
    expect(() => JobEnvelope.parse({ ...ok, kind: 'UNKNOWN_KIND' })).toThrow();
    expect(() => JobEnvelope.parse({ ...ok, attempt: 0 })).toThrow();
    expect(() => JobEnvelope.parse({ ...ok, budgetCapKrw: -1 })).toThrow();
    expect(() => JobEnvelope.parse({ ...ok, idempotencyKey: 'short' })).toThrow();
  });

  it('SelectionResult 는 최소 1건과 0~100 점수를 요구한다', () => {
    const item = {
      assetId: UUID, rank: 1, fitScore: 88.4,
      reason: { matched: { outfit: ['casual'] }, licenseOk: true, validUntil: '2027-01-01' },
    };
    expect(() => SelectionResult.parse({ orderId: UUID, items: [item] })).not.toThrow();
    expect(() => SelectionResult.parse({ orderId: UUID, items: [] })).toThrow();
    expect(() => SelectionResult.parse({ orderId: UUID, items: [{ ...item, fitScore: 101 }] })).toThrow();
    expect(() => SelectionResult.parse({ orderId: UUID, items: [{ ...item, rank: 0 }] })).toThrow();
  });

  it('BlueprintResult 의 Scene 은 1~15초 범위다', () => {
    const bp = {
      blueprintId: UUID, channelId: UUID, seq: 1, outputType: 'VIDEO' as const,
      scenePlan: [{ seq: 1, durationMs: 4000, sourceType: 'AI_VIDEO' as const }],
    };
    expect(() => BlueprintResult.parse({ orderId: UUID, blueprints: [bp] })).not.toThrow();
    expect(() => BlueprintResult.parse({
      orderId: UUID, blueprints: [{ ...bp, scenePlan: [{ seq: 1, durationMs: 500, sourceType: 'AI_VIDEO' }] }],
    })).toThrow();
  });

  it('GenerationResult 는 계보용 원본을 최소 1건 요구한다', () => {
    const artifact = { kind: 'VIDEO' as const, storageKey: 'k', provider: 'p', costKrw: 100 };
    expect(() => GenerationResult.parse({
      contentId: UUID, artifacts: [artifact], sourceAssetIds: [UUID],
    })).not.toThrow();
    // 계보가 비면 V2 성과 역추적이 불가능해지므로 계약 단계에서 막는다.
    expect(() => GenerationResult.parse({
      contentId: UUID, artifacts: [artifact], sourceAssetIds: [],
    })).toThrow();
    expect(() => GenerationResult.parse({
      contentId: UUID, artifacts: [{ ...artifact, identityScore: 1.5 }], sourceAssetIds: [UUID],
    })).toThrow();
  });

  it('RenderResult · QcHandoff · PublishResult 스키마', () => {
    expect(() => RenderResult.parse({ contentId: UUID, storageKey: 'k', durationMs: 30000, costKrw: 0 })).not.toThrow();
    expect(() => RenderResult.parse({ contentId: UUID, storageKey: 'k', durationMs: 0, costKrw: 0 })).toThrow();

    expect(() => QcHandoff.parse({
      contentId: UUID, attempt: 1, verdict: 'PASS', totalScore: 88.4, retryTarget: null,
    })).not.toThrow();
    expect(() => QcHandoff.parse({
      contentId: UUID, attempt: 1, verdict: 'MAYBE', totalScore: 88, retryTarget: null,
    })).toThrow();

    expect(() => PublishResult.parse({
      contentId: UUID,
      publications: [{ channelId: UUID, externalId: 'x', externalUrl: 'u', visibility: 'PRIVATE' }],
    })).not.toThrow();
  });
});
