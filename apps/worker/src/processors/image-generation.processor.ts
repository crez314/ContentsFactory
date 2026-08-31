import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Artist, Asset, AssetUsage, Blueprint, Content, GeneratedAsset, Order, Selection,
} from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { GenerationResult, type JobEnvelope } from '@cf/queue';
import type { JobCtx } from '@cf/model-abstraction';
import { IdentityService } from '../generation/identity.service';
import { CaptionService } from '../generation/caption.service';
import type { TaskProcessor } from './processor.registry';

/**
 * 이미지 트랙.
 * Blueprint 의 레이아웃·스타일로 1장을 생성하고, Identity 검증을 통과한 결과를
 * 콘텐츠의 최종 산출물로 확정한다. 사용된 원본은 asset_usages 에 남긴다.
 */
@Injectable()
export class ImageGenerationProcessor implements TaskProcessor {
  private readonly log = createLogger('image-generation');

  constructor(
    private readonly ds: DataSource,
    private readonly identity: IdentityService,
    private readonly captions: CaptionService,
    private readonly storage: StorageService,
  ) {}

  async process(envelope: JobEnvelope): Promise<GenerationResult> {
    const contentId = envelope.contentId!;
    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const blueprint = await this.ds.getRepository(Blueprint).findOne({
      where: { id: content.blueprintId },
      relations: { channel: true },
    });
    const order = await this.ds.getRepository(Order).findOne({ where: { id: content.orderId } });
    if (!blueprint || !order) throw new AppError('CONTENT_INVALID_STATE');

    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: order.artistId } });
    const selection = await this.ds.getRepository(Selection).findOne({
      where: { orderId: order.id },
      order: { rank: 'ASC' },
    });
    if (!selection) throw new AppError('INSUFFICIENT_ASSETS', { details: [{ orderId: order.id }] });

    const sourceAsset = await this.ds.getRepository(Asset).findOne({ where: { id: selection.assetId } });
    const attempt = Number(envelope.attempt ?? 1);

    const ctx: JobCtx & { artistId: string } = {
      taskId: envelope.taskId,
      orderId: order.id,
      contentId,
      agentId: order.agentId,
      artistId: order.artistId,
      maxCostKrw: envelope.budgetCapKrw > 0 ? envelope.budgetCapKrw : undefined,
    };

    const result = await this.identity.verifyAndRegenerate(
      'image',
      {
        prompt: this.prompt(order, blueprint),
        aspect: blueprint.layout.aspect ?? '9:16',
        identityRefKeys: artist?.identityRef?.refKeys ?? [],
        sourceAssetKey: sourceAsset?.storageKey,
        outputKey: `generated/${order.artistId}/${contentId}/image-a${attempt}`,
        palette: blueprint.style.palette,
        seed: null,
      },
      ctx,
    );

    // 산출물 기록
    const genRepo = this.ds.getRepository(GeneratedAsset);
    await genRepo.save(genRepo.create({
      contentId,
      sceneId: null,
      kind: 'IMAGE',
      storageKey: result.storageKey,
      provider: result.provider,
      modelVersion: result.modelVersion ?? null,
      costKrw: result.costKrw,
      latencyMs: result.latencyMs,
      identityScore: result.identityScore,
      cacheKey: (result.meta.cacheKey as string) ?? null,
      meta: result.meta,
    }));

    // 계보 기록 (§2.1)
    await this.recordUsage(contentId, [selection.assetId]);

    const caption = await this.captions.build(order, blueprint, content);
    const head = await this.storage.head(result.storageKey);
    await this.ds.getRepository(Content).update(contentId, {
      finalKey: result.storageKey,
      title: caption.title,
      description: caption.description,
      hashtags: caption.hashtags,
      status: 'QC',
      durationMs: null,
    });

    const handoff: GenerationResult = {
      contentId,
      artifacts: [{
        kind: 'IMAGE',
        storageKey: result.storageKey,
        provider: result.provider,
        costKrw: result.costKrw,
        identityScore: result.identityScore ?? undefined,
      }],
      sourceAssetIds: [selection.assetId],
    };
    GenerationResult.parse(handoff);
    this.log.info('image generated', {
      contentId, provider: result.provider, costKrw: result.costKrw, bytes: head?.size,
    });
    return handoff;
  }

  private prompt(order: Order, blueprint: Blueprint): string {
    return [
      String(order.concept.campaign ?? ''),
      String(order.concept.story ?? '').replace(/_/g, ' '),
      `mood=${order.concept.mood ?? 'bright'}`,
      `tone=${blueprint.style.tone ?? 'warm'}`,
      `template=${blueprint.style.template ?? 'crez_basic_v1'}`,
      `aspect=${blueprint.layout.aspect}`,
    ].filter(Boolean).join(' | ');
  }

  private async recordUsage(contentId: string, assetIds: string[]): Promise<void> {
    const repo = this.ds.getRepository(AssetUsage);
    const weight = 1 / Math.max(1, assetIds.length);
    for (const assetId of assetIds) {
      await repo
        .createQueryBuilder()
        .insert()
        .values({ contentId, assetId, sceneId: null, usageWeight: weight })
        .orIgnore()
        .execute();
    }
  }
}
