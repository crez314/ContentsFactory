import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import {
  Artist, Asset, AssetLicense, AssetUsage, MasterAttributeValue,
  ATTRIBUTE_STANDARDS, ATTRIBUTE_NAMES, validateAttributes, type AttributeName,
} from '@cf/domain';
import { AppError, config, createLogger, ulid } from '@cf/common';
import { StorageService } from '@cf/storage';
import { QUEUE, getRedis } from '@cf/queue';
import { Queue } from 'bullmq';
import { encodeCursor, parsePaging } from '../common/pagination';

export interface AssetSearchQuery {
  artistId?: string;
  status?: string;
  mediaType?: string;
  qualityGrade?: string;
  taggingStatus?: string;
  /** attr:angle=front,side_left 형태로 반복 지정 */
  attrs?: Record<string, string[]>;
  channel?: string;
  region?: string;
  licenseValidOn?: string;
  limit?: string;
  cursor?: string;
}

/**
 * §4.1 Asset Module.
 * 업로드는 Presigned URL 로 클라이언트가 스토리지에 직접 올리고,
 * 완료 콜백에서 실제 업로드를 확인한 뒤 비동기 태깅 큐에 넣는다.
 */
@Injectable()
export class AssetService {
  private readonly log = createLogger('asset');
  private readonly taggingQueue: Queue;

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
  ) {
    this.taggingQueue = new Queue('q.tagging', {
      connection: getRedis(),
      prefix: config.redis.queuePrefix,
    });
  }

  async createUploadUrl(dto: {
    artistId: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    mediaType: 'PHOTO' | 'VIDEO' | 'AUDIO';
  }) {
    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: dto.artistId } });
    if (!artist) throw new AppError('NOT_FOUND', { message: '아티스트를 찾을 수 없습니다.' });

    const safeName = dto.filename.replace(/[^\w.\-]/g, '_');
    const key = `assets/${dto.artistId}/${ulid()}/${safeName}`;
    const url = await this.storage.presignPut(key, dto.mimeType, config.storage.presignTtlSec);

    const asset = this.ds.getRepository(Asset).create({
      artistId: dto.artistId,
      mediaType: dto.mediaType,
      storageKey: key,
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      status: 'UPLOADING',
      attributes: {},
    });
    await this.ds.getRepository(Asset).save(asset);

    return { assetId: asset.id, uploadUrl: url, storageKey: key, expiresIn: config.storage.presignTtlSec };
  }

  /** 스토리지에 실제로 올라왔는지 확인한 뒤에만 ACTIVE 로 올린다. */
  async completeUpload(assetId: string) {
    const repo = this.ds.getRepository(Asset);
    const asset = await repo.findOne({ where: { id: assetId } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');

    const head = await this.storage.head(asset.storageKey);
    if (!head) throw new AppError('ASSET_UPLOAD_NOT_FOUND', { details: [{ storageKey: asset.storageKey }] });

    await repo.update(assetId, { status: 'ACTIVE', fileSize: head.size });
    await this.taggingQueue.add('auto-tag', { assetId }, { removeOnComplete: 100, removeOnFail: 200 });
    this.log.info('upload completed', { assetId, bytes: head.size });
    return this.findOne(assetId);
  }

  async findOne(id: string) {
    const asset = await this.ds.getRepository(Asset).findOne({ where: { id }, relations: { licenses: true } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    const usageCount = await this.ds.getRepository(AssetUsage).count({ where: { assetId: id } });
    const previewUrl = await this.storage.presignGet(asset.storageKey).catch(() => null);
    return { ...asset, usageCount, previewUrl };
  }

  async search(q: AssetSearchQuery) {
    const { limit, cursor } = parsePaging(q);
    const qb = this.ds
      .getRepository(Asset)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.licenses', 'l')
      .where('a.deleted_at IS NULL');

    if (q.artistId) qb.andWhere('a.artist_id = :artistId', { artistId: q.artistId });
    if (q.status) qb.andWhere('a.status = :status', { status: q.status });
    if (q.mediaType) qb.andWhere('a.media_type = :mediaType', { mediaType: q.mediaType });
    if (q.qualityGrade) qb.andWhere('a.quality_grade = :grade', { grade: q.qualityGrade });
    if (q.taggingStatus) qb.andWhere('a.tagging_status = :ts', { ts: q.taggingStatus });

    // jsonb 속성 필터 — gin 인덱스(jsonb_path_ops)를 쓰도록 @> 로 작성한다.
    let i = 0;
    for (const [attr, values] of Object.entries(q.attrs ?? {})) {
      if (!values.length) continue;
      qb.andWhere(
        new Brackets((w) => {
          values.forEach((v, j) => {
            const p = `attr${i}_${j}`;
            const clause = `a.attributes @> :${p}::jsonb`;
            const param = { [p]: JSON.stringify({ [attr]: v }) };
            j === 0 ? w.where(clause, param) : w.orWhere(clause, param);
          });
        }),
      );
      i += 1;
    }

    if (q.channel) qb.andWhere(':ch = ANY(l.allowed_channels)', { ch: q.channel.toLowerCase() });
    if (q.region) qb.andWhere(':rg = ANY(l.allowed_regions)', { rg: q.region.toUpperCase() });
    if (q.licenseValidOn) {
      qb.andWhere('l.valid_from <= :on AND l.valid_until >= :on', { on: q.licenseValidOn });
    }

    if (cursor) {
      qb.andWhere('(a.created_at, a.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });
    }

    const items = await qb.orderBy('a.createdAt', 'DESC').addOrderBy('a.id', 'DESC').take(limit + 1).getMany();
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
  }

  /** 운영자 태깅 검토 — 마스터 허용값만 통과시킨다. */
  async updateAttributes(id: string, attributes: Record<string, string>, opts: { markReviewed: boolean }) {
    const repo = this.ds.getRepository(Asset);
    const asset = await repo.findOne({ where: { id } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');

    const allowed = await this.allowedAttributeValues();
    const issues = validateAttributes(attributes, allowed);
    if (issues.length) {
      throw new AppError('INVALID_INPUT', {
        message: '표준값에 없는 속성이 포함되어 있습니다.',
        details: issues,
      });
    }

    asset.attributes = { ...asset.attributes, ...attributes };
    if (opts.markReviewed) asset.taggingStatus = 'REVIEWED';
    await repo.save(asset);
    return this.findOne(id);
  }

  async allowedAttributeValues(): Promise<Record<string, string[]>> {
    const rows = await this.ds.getRepository(MasterAttributeValue).find({ where: { active: true } });
    if (!rows.length) return ATTRIBUTE_STANDARDS as unknown as Record<string, string[]>;
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.attribute] ??= []).push(r.value);
    return out;
  }

  async upsertLicense(assetId: string, dto: {
    allowedChannels: string[];
    allowedRegions: string[];
    derivativeAllowed: boolean;
    validFrom: string;
    validUntil: string;
    contractRef?: string;
    note?: string;
  }) {
    const asset = await this.ds.getRepository(Asset).findOne({ where: { id: assetId } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    if (dto.validUntil < dto.validFrom) {
      throw new AppError('INVALID_INPUT', { message: 'validUntil 은 validFrom 이후여야 합니다.' });
    }

    const repo = this.ds.getRepository(AssetLicense);
    const existing = await repo.findOne({ where: { assetId }, order: { createdAt: 'DESC' } });
    const payload = {
      assetId,
      allowedChannels: dto.allowedChannels.map((c) => c.toLowerCase()),
      allowedRegions: dto.allowedRegions.map((r) => r.toUpperCase()),
      derivativeAllowed: dto.derivativeAllowed,
      validFrom: dto.validFrom,
      validUntil: dto.validUntil,
      contractRef: dto.contractRef ?? null,
      note: dto.note ?? null,
    };
    if (existing) {
      await repo.update(existing.id, payload);
      return repo.findOne({ where: { id: existing.id } });
    }
    return repo.save(repo.create(payload));
  }

  /**
   * §7.2 자산 커버리지 — 속성 조합별 보유 수량.
   * V2 촬영 가이드 환류가 이 화면 위에 얹힌다.
   */
  async coverage(artistId: string | undefined, rowAttr: AttributeName, colAttr: AttributeName) {
    if (!ATTRIBUTE_NAMES.includes(rowAttr) || !ATTRIBUTE_NAMES.includes(colAttr)) {
      throw new AppError('INVALID_INPUT', { message: '지원하지 않는 속성입니다.' });
    }
    const allowed = await this.allowedAttributeValues();
    const rows = allowed[rowAttr] ?? [];
    const cols = allowed[colAttr] ?? [];

    const qb = this.ds
      .getRepository(Asset)
      .createQueryBuilder('a')
      .select(`a.attributes ->> '${rowAttr}'`, 'row')
      .addSelect(`a.attributes ->> '${colAttr}'`, 'col')
      .addSelect('COUNT(*)', 'count')
      .where('a.deleted_at IS NULL')
      .andWhere("a.status = 'ACTIVE'")
      .groupBy('1').addGroupBy('2');
    if (artistId) qb.andWhere('a.artist_id = :artistId', { artistId });

    const raw = await qb.getRawMany<{ row: string | null; col: string | null; count: string }>();
    const matrix: Record<string, Record<string, number>> = {};
    for (const r of rows) matrix[r] = Object.fromEntries(cols.map((c) => [c, 0]));
    let total = 0;
    for (const r of raw) {
      const n = Number(r.count);
      total += n;
      if (r.row && r.col && matrix[r.row] && r.col in matrix[r.row]) matrix[r.row][r.col] = n;
    }
    return { rowAttr, colAttr, rows, cols, matrix, total };
  }
}
