import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Artist, Asset, AssetUsage, Blueprint, Content, GeneratedAsset, Order, Scene } from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { GenerationResult, type JobEnvelope } from '@cf/queue';
import type { JobCtx } from '@cf/model-abstraction';
import { IdentityService } from '../generation/identity.service';
import type { TaskProcessor } from './processor.registry';

/**
 * 영상 트랙 — Scene 단위 생성.
 * Task 하나가 Scene 하나를 담당하므로 부분 재생성이 Scene 단위로 가능하다.
 * REAL_IMAGE Scene 은 원본을 그대로 쓰므로 생성 비용이 들지 않는다.
 */
@Injectable()
export class VideoGenerationProcessor implements TaskProcessor {
  private readonly log = createLogger('video-generation');

  constructor(
    private readonly ds: DataSource,
    private readonly identity: IdentityService,
    private readonly storage: StorageService,
  ) {}

  async process(envelope: JobEnvelope): Promise<GenerationResult> {
    const contentId = envelope.contentId!;
    const sceneId = envelope.sceneId!;
    const scene = await this.ds.getRepository(Scene).findOne({ where: { id: sceneId, contentId } });
    if (!scene) throw new AppError('NOT_FOUND', { message: 'Scene 을 찾을 수 없습니다.' });

    // 이미 완료된 Scene 은 다시 만들지 않는다 (§3.5 멱등).
    if (scene.status === 'DONE') {
      const prior = await this.ds.getRepository(GeneratedAsset).findOne({
        where: { sceneId }, order: { createdAt: 'DESC' },
      });
      if (prior) {
        return {
          contentId,
          artifacts: [{ kind: prior.kind, storageKey: prior.storageKey, provider: prior.provider, costKrw: 0, sceneId }],
          sourceAssetIds: [scene.sourceAssetId ?? (await this.anySourceAsset(contentId))],
        };
      }
    }

    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    const blueprint = await this.ds.getRepository(Blueprint).findOne({ where: { id: content!.blueprintId } });
    const order = await this.ds.getRepository(Order).findOne({ where: { id: content!.orderId } });
    if (!content || !blueprint || !order) throw new AppError('CONTENT_INVALID_STATE');

    await this.ds.getRepository(Scene).update(sceneId, { status: 'GENERATING' });

    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: order.artistId } });
    const sourceAsset = scene.sourceAssetId
      ? await this.ds.getRepository(Asset).findOne({ where: { id: scene.sourceAssetId } })
      : null;

    const attempt = Number(envelope.attempt ?? 1);
    const ctx: JobCtx & { artistId: string } = {
      taskId: envelope.taskId,
      orderId: order.id,
      contentId,
      sceneId,
      agentId: order.agentId,
      artistId: order.artistId,
      maxCostKrw: envelope.budgetCapKrw > 0 ? envelope.budgetCapKrw : undefined,
    };

    let artifact: { kind: 'IMAGE' | 'VIDEO'; storageKey: string; provider: string; costKrw: number; identityScore?: number };

    if (scene.sourceType === 'REAL_IMAGE' && sourceAsset) {
      // 실사 Scene: 원본을 그대로 쓴다. 생성 호출도 비용도 없다.
      const key = `generated/${order.artistId}/${contentId}/scene-${scene.seq}-real.png`;
      await this.storage.copy(sourceAsset.storageKey, key);
      artifact = { kind: 'IMAGE', storageKey: key, provider: 'source-passthrough', costKrw: 0 };
    } else {
      const result = await this.identity.verifyAndRegenerate(
        'video',
        {
          prompt: scene.prompt ?? blueprint.style.template ?? 'crez scene',
          aspect: blueprint.layout.aspect ?? '9:16',
          durationSec: Math.round(scene.durationMs / 1000),
          identityRefKeys: artist?.identityRef?.refKeys ?? [],
          sourceAssetKey: sourceAsset?.storageKey,
          outputKey: `generated/${order.artistId}/${contentId}/scene-${scene.seq}-a${attempt}`,
          palette: blueprint.style.palette,
          seed: null,
        },
        ctx,
      );
      artifact = {
        kind: 'VIDEO',
        storageKey: result.storageKey,
        provider: result.provider,
        costKrw: result.costKrw,
        identityScore: result.identityScore ?? undefined,
      };

      const genRepo = this.ds.getRepository(GeneratedAsset);
      await genRepo.save(genRepo.create({
        contentId, sceneId, kind: 'VIDEO',
        storageKey: result.storageKey, provider: result.provider,
        modelVersion: result.modelVersion ?? null, costKrw: result.costKrw,
        latencyMs: result.latencyMs, identityScore: result.identityScore,
        cacheKey: (result.meta.cacheKey as string) ?? null, meta: result.meta,
      }));
    }

    if (artifact.provider === 'source-passthrough') {
      const genRepo = this.ds.getRepository(GeneratedAsset);
      await genRepo.save(genRepo.create({
        contentId, sceneId, kind: 'IMAGE',
        storageKey: artifact.storageKey, provider: artifact.provider,
        costKrw: 0, latencyMs: 0, meta: { passthrough: true, sourceAssetId: sourceAsset!.id },
      }));
    }

    // 계보 기록 — Scene 단위
    if (scene.sourceAssetId) {
      await this.ds.getRepository(AssetUsage)
        .createQueryBuilder().insert()
        .values({ contentId, assetId: scene.sourceAssetId, sceneId, usageWeight: 1 })
        .orIgnore().execute();
    }

    await this.ds.getRepository(Scene).update(sceneId, { status: 'DONE' });

    const handoff: GenerationResult = {
      contentId,
      artifacts: [{ ...artifact, sceneId }],
      sourceAssetIds: [scene.sourceAssetId ?? (await this.anySourceAsset(contentId))],
    };
    GenerationResult.parse(handoff);
    this.log.info('scene generated', {
      contentId, sceneId, provider: artifact.provider, costKrw: artifact.costKrw, seq: scene.seq,
    });
    return handoff;
  }

  /** 계보 스키마가 최소 1건을 요구하므로, Scene 에 원본이 없으면 콘텐츠의 다른 원본을 쓴다. */
  private async anySourceAsset(contentId: string): Promise<string> {
    const usage = await this.ds.getRepository(AssetUsage).findOne({ where: { contentId } });
    if (usage) return usage.assetId;
    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    const sel = await this.ds.query<Array<{ asset_id: string }>>(
      'SELECT asset_id FROM selections WHERE order_id = $1 ORDER BY rank ASC LIMIT 1',
      [content!.orderId],
    );
    if (!sel.length) throw new AppError('INSUFFICIENT_ASSETS', { details: [{ contentId }] });
    return sel[0].asset_id;
  }
}
