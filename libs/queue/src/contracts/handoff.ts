import { z } from 'zod';
import { GENERATED_KIND, SCENE_SOURCE_TYPE } from '@cf/domain';

/**
 * §3.2 단계 간 Handoff 스키마.
 * 계약 테스트(§12)가 이 스키마를 검증하므로, 스키마를 바꾸면 테스트가 먼저 깨진다.
 */

export const SelectionResult = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({
    assetId:  z.string().uuid(),
    rank:     z.number().int().positive(),
    fitScore: z.number().min(0).max(100),
    reason: z.object({
      matched:    z.record(z.string(), z.array(z.string())),
      licenseOk:  z.boolean(),
      validUntil: z.string(),
    }),
  })).min(1),
});
export type SelectionResult = z.infer<typeof SelectionResult>;

export const ScenePlanSchema = z.object({
  seq:           z.number().int().positive(),
  durationMs:    z.number().int().min(1000).max(15000),
  sourceType:    z.enum(SCENE_SOURCE_TYPE),
  sourceAssetId: z.string().uuid().optional(),
  prompt:        z.string().optional(),
  subtitle:      z.string().optional(),
});

export const BlueprintResult = z.object({
  orderId: z.string().uuid(),
  blueprints: z.array(z.object({
    blueprintId: z.string().uuid(),
    channelId:   z.string().uuid(),
    seq:         z.number().int().positive(),
    outputType:  z.enum(['IMAGE', 'VIDEO']),
    scenePlan:   z.array(ScenePlanSchema),
  })).min(1),
});
export type BlueprintResult = z.infer<typeof BlueprintResult>;

export const GenerationResult = z.object({
  contentId: z.string().uuid(),
  artifacts: z.array(z.object({
    kind:          z.enum(GENERATED_KIND),
    storageKey:    z.string(),
    provider:      z.string(),
    costKrw:       z.number().nonnegative(),
    identityScore: z.number().min(0).max(1).optional(),
    sceneId:       z.string().uuid().optional(),
  })).min(1),
  /** 계보 기록용 (§2.1 asset_usages) */
  sourceAssetIds: z.array(z.string().uuid()).min(1),
});
export type GenerationResult = z.infer<typeof GenerationResult>;

export const RenderResult = z.object({
  contentId:  z.string().uuid(),
  storageKey: z.string(),
  durationMs: z.number().int().positive(),
  costKrw:    z.number().nonnegative(),
});
export type RenderResult = z.infer<typeof RenderResult>;

export const QcHandoff = z.object({
  contentId:   z.string().uuid(),
  attempt:     z.number().int().positive(),
  verdict:     z.enum(['PASS', 'FAIL', 'BLOCKED']),
  totalScore:  z.number().min(0).max(100),
  retryTarget: z.string().nullable(),
});
export type QcHandoff = z.infer<typeof QcHandoff>;

export const PublishResult = z.object({
  contentId:     z.string().uuid(),
  publications:  z.array(z.object({
    channelId:   z.string().uuid(),
    externalId:  z.string(),
    externalUrl: z.string(),
    visibility:  z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']),
  })).min(1),
});
export type PublishResult = z.infer<typeof PublishResult>;
