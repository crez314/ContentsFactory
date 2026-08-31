import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Approval, Asset, AssetUsage, Blueprint, Content, CostLog, GeneratedAsset,
  Publication, QcResult, Scene, canTransitionContent, moduleForRetryTarget,
} from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { encodeCursor, parsePaging } from '../common/pagination';
import { TaskFactory } from '@cf/orchestration';

@Injectable()
export class ContentService {
  private readonly log = createLogger('content');

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly tasks: TaskFactory,
  ) {}

  async list(q: { status?: string; orderId?: string; outputType?: string; limit?: string; cursor?: string }) {
    const { limit, cursor } = parsePaging(q);
    const qb = this.ds
      .getRepository(Content)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.order', 'o')
      .leftJoinAndSelect('o.artist', 'artist');

    if (q.status) qb.andWhere('c.status = ANY(:statuses)', { statuses: q.status.split(',') });
    if (q.orderId) qb.andWhere('c.order_id = :orderId', { orderId: q.orderId });
    if (q.outputType) qb.andWhere('c.output_type = :ot', { ot: q.outputType });
    if (cursor) qb.andWhere('(c.created_at, c.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });

    const rows = await qb.orderBy('c.createdAt', 'DESC').addOrderBy('c.id', 'DESC').take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = await Promise.all(
      page.map(async (c) => ({
        ...c,
        thumbnailUrl: await this.thumbnailUrl(c),
        qc: await this.ds.getRepository(QcResult).findOne({ where: { contentId: c.id }, order: { attempt: 'DESC' } }),
      })),
    );
    return { items, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
  }

  /** §5.3 콘텐츠 상세 — Scene·QC·계보·비용 포함 */
  async findOne(id: string) {
    const content = await this.ds.getRepository(Content).findOne({
      where: { id },
      relations: { order: { artist: true }, blueprint: { channel: true } },
    });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const [scenes, qcHistory, artifacts, approvals, publications, costs] = await Promise.all([
      this.ds.getRepository(Scene).find({ where: { contentId: id }, order: { seq: 'ASC' } }),
      this.ds.getRepository(QcResult).find({ where: { contentId: id }, order: { attempt: 'DESC' } }),
      this.ds.getRepository(GeneratedAsset).find({ where: { contentId: id }, order: { createdAt: 'ASC' } }),
      this.ds.getRepository(Approval).find({ where: { contentId: id }, relations: { decider: true }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(Publication).find({ where: { contentId: id }, relations: { channel: true } }),
      this.ds.getRepository(CostLog).find({ where: { contentId: id } }),
    ]);

    const costByProvider: Record<string, number> = {};
    for (const c of costs) costByProvider[c.provider] = (costByProvider[c.provider] ?? 0) + c.costKrw;
    const costKrw = costs.reduce((s, c) => s + c.costKrw, 0);

    return {
      ...content,
      previewUrl: content.finalKey ? await this.storage.presignGet(content.finalKey) : null,
      thumbnailUrl: await this.thumbnailUrl(content),
      scenes: await Promise.all(scenes.map(async (s) => ({
        ...s,
        previewUrl: await this.scenePreviewUrl(s.id),
      }))),
      qc: qcHistory[0] ?? null,
      qcHistory,
      artifacts,
      approvals,
      publications,
      lineage: await this.lineage(id),
      costKrw,
      costByProvider,
    };
  }

  /** §5.2 콘텐츠 계보 조회 — 어떤 원본에서 나왔는가 */
  async lineage(contentId: string) {
    const usages = await this.ds.getRepository(AssetUsage).find({ where: { contentId } });
    if (!usages.length) return { sourceAssetIds: [], items: [] };

    const assets = await this.ds.getRepository(Asset).findByIds(usages.map((u) => u.assetId));
    const byId = new Map(assets.map((a) => [a.id, a]));

    const items = await Promise.all(
      usages.map(async (u) => {
        const asset = byId.get(u.assetId);
        return {
          assetId: u.assetId,
          sceneId: u.sceneId,
          usageWeight: u.usageWeight,
          attributes: asset?.attributes ?? {},
          qualityGrade: asset?.qualityGrade ?? null,
          thumbnailUrl: asset ? await this.storage.presignGet(asset.storageKey).catch(() => null) : null,
        };
      }),
    );
    return { sourceAssetIds: [...new Set(usages.map((u) => u.assetId))], items };
  }

  async previewUrl(id: string) {
    const content = await this.ds.getRepository(Content).findOne({ where: { id } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');
    if (!content.finalKey) throw new AppError('CONTENT_INVALID_STATE', { message: '아직 산출물이 없습니다.' });
    return { url: await this.storage.presignGet(content.finalKey), expiresIn: 900 };
  }

  /**
   * §5.2 부분 재생성.
   * 대상 영역을 지정하면 그 영역에 해당하는 모듈만 다시 돌린다.
   * Scene 을 지정하면 그 Scene 만 재생성한다.
   */
  async regenerate(id: string, opts: { target?: string; sceneId?: string }) {
    const repo = this.ds.getRepository(Content);
    const content = await repo.findOne({ where: { id }, relations: { order: true } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const nextStatus = content.outputType === 'VIDEO' ? 'GENERATING' : 'GENERATING';
    if (!canTransitionContent(content.status, nextStatus)) {
      throw new AppError('CONTENT_INVALID_STATE', { details: [{ from: content.status, to: nextStatus }] });
    }

    const attempts = await this.ds.getRepository(QcResult).count({ where: { contentId: id } });
    const kind = moduleForRetryTarget(opts.target ?? null, content.outputType as 'IMAGE' | 'VIDEO');

    if (opts.sceneId) {
      const scene = await this.ds.getRepository(Scene).findOne({ where: { id: opts.sceneId, contentId: id } });
      if (!scene) throw new AppError('NOT_FOUND', { message: 'Scene 을 찾을 수 없습니다.' });
      await this.ds.getRepository(Scene).update(scene.id, { status: 'PENDING', retryCount: scene.retryCount + 1 });
    }

    await repo.update(id, { status: nextStatus });
    const task = await this.tasks.createTask({
      kind,
      orderId: content.orderId,
      contentId: id,
      sceneId: opts.sceneId ?? null,
      agentId: content.order?.agentId ?? null,
      priority: 1,
      attempt: attempts + 1,
      payload: { contentId: id, sceneId: opts.sceneId, retryTarget: opts.target ?? null, manual: true },
    });

    this.log.info('regeneration requested', { contentId: id, kind, sceneId: opts.sceneId, taskId: task.id });
    return { taskId: task.id, kind, status: nextStatus };
  }

  /** 승인 대기열 (§7.1) */
  async approvalQueue(limit = 50) {
    const rows = await this.ds.getRepository(Content).find({
      where: { status: 'READY' },
      relations: { order: { artist: true } },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    return Promise.all(
      rows.map(async (c) => ({
        ...c,
        thumbnailUrl: await this.thumbnailUrl(c),
        qc: await this.ds.getRepository(QcResult).findOne({ where: { contentId: c.id }, order: { attempt: 'DESC' } }),
      })),
    );
  }

  private async thumbnailUrl(content: Content): Promise<string | null> {
    if (content.outputType !== 'VIDEO' && content.finalKey) {
      return this.storage.presignGet(content.finalKey).catch(() => null);
    }
    // 영상은 첫 Scene 의 포스터 프레임을 쓴다.
    const poster = await this.ds.getRepository(GeneratedAsset).findOne({
      where: { contentId: content.id, kind: 'IMAGE' },
      order: { createdAt: 'ASC' },
    });
    const key = (poster?.meta?.posterKey as string | undefined) ?? poster?.storageKey;
    if (!key) return null;
    return this.storage.presignGet(key).catch(() => null);
  }

  private async scenePreviewUrl(sceneId: string): Promise<string | null> {
    const artifact = await this.ds.getRepository(GeneratedAsset).findOne({
      where: { sceneId },
      order: { createdAt: 'DESC' },
    });
    if (!artifact) return null;
    return this.storage.presignGet(artifact.storageKey).catch(() => null);
  }
}
