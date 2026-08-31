import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Asset, AssetUsage, Order, Selection, fitScore, passesExclude } from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { SelectionResult, type JobEnvelope } from '@cf/queue';
import type { TaskProcessor } from './processor.registry';

/**
 * §4.3 Selection Module.
 * 오더 조건과 라이브러리를 매칭해 사용할 원본을 선별하고 적합도 순위를 매긴다.
 */
@Injectable()
export class SelectionProcessor implements TaskProcessor {
  private readonly log = createLogger('selection-processor');

  constructor(private readonly ds: DataSource) {}

  async process(envelope: JobEnvelope): Promise<SelectionResult> {
    const orderId = envelope.orderId!;
    const order = await this.ds.getRepository(Order).findOne({
      where: { id: orderId },
      relations: { channels: true },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND');

    const candidates = await this.candidates(order);
    if (!candidates.length) {
      throw new AppError('INSUFFICIENT_ASSETS', { details: [{ orderId, found: 0 }] });
    }

    // 사용 편중 억제를 위해 자산별 누적 사용 횟수를 미리 집계한다.
    const usage = await this.usageCounts(candidates.map((a) => a.id));
    const publishDate = (order.scheduledAt ?? new Date()).toISOString().slice(0, 10);

    const scored = candidates
      .map((asset) => {
        const license = (asset.licenses ?? [])
          .filter((l) => l.validUntil >= publishDate)
          .sort((a, b) => (a.validUntil < b.validUntil ? 1 : -1))[0];
        const { score, breakdown } = fitScore(
          {
            attributes: asset.attributes,
            qualityGrade: asset.qualityGrade,
            shotAt: asset.shotAt,
            licenseValidUntil: license?.validUntil ?? null,
            usageCount: usage.get(asset.id) ?? 0,
          },
          order.assetFilter,
        );
        return { asset, license, score, breakdown };
      })
      // 게시 시점에 유효한 라이선스가 없는 자산은 선별 대상에서 뺀다.
      .filter((s) => Boolean(s.license))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      throw new AppError('LICENSE_EXPIRED', { details: [{ orderId, publishDate }] });
    }

    // 필요 수량의 3배를 상한으로 잡아 Blueprint 가 조합할 여유를 준다.
    const take = Math.min(scored.length, Math.max(8, order.quantity * (order.channels?.length ?? 1) * 3));
    const chosen = scored.slice(0, take);

    const repo = this.ds.getRepository(Selection);
    await repo.delete({ orderId }); // 재실행 시 이전 결과를 갈아엎는다.
    await repo.save(
      chosen.map((s, i) =>
        repo.create({
          orderId,
          assetId: s.asset.id,
          rank: i + 1,
          fitScore: s.score,
          reason: {
            matched: s.breakdown.matched,
            licenseOk: true,
            validUntil: s.license!.validUntil,
            breakdown: {
              attrMatch: s.breakdown.attrMatch,
              quality: s.breakdown.quality,
              freshness: s.breakdown.freshness,
              licenseMargin: s.breakdown.licenseMargin,
              usageBalance: s.breakdown.usageBalance,
            },
          },
        }),
      ),
    );

    const result: SelectionResult = {
      orderId,
      items: chosen.map((s, i) => ({
        assetId: s.asset.id,
        rank: i + 1,
        fitScore: s.score,
        reason: { matched: s.breakdown.matched, licenseOk: true, validUntil: s.license!.validUntil },
      })),
    };
    SelectionResult.parse(result); // 계약 검증 (§12 계약 테스트와 동일 스키마)
    this.log.info('selection completed', { orderId, selected: chosen.length, topScore: chosen[0].score });
    return result;
  }

  private async candidates(order: Order): Promise<Asset[]> {
    const qb = this.ds
      .getRepository(Asset)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.licenses', 'l')
      .where('a.artist_id = :artistId', { artistId: order.artistId })
      .andWhere("a.status = 'ACTIVE'")
      .andWhere('a.deleted_at IS NULL')
      .andWhere('l.derivative_allowed = true');

    let i = 0;
    for (const [attr, values] of Object.entries(order.assetFilter.include ?? {})) {
      if (!values?.length) continue;
      const clauses = values.map((v, j) => {
        const p = `inc${i}_${j}`;
        qb.setParameter(p, JSON.stringify({ [attr]: v }));
        return `a.attributes @> :${p}::jsonb`;
      });
      qb.andWhere(`(${clauses.join(' OR ')})`);
      i += 1;
    }

    // 채널·지역 허용 여부는 오더의 대상 채널 전부를 만족해야 한다.
    for (const ch of order.channels ?? []) {
      qb.andWhere(':plat_' + ch.id.slice(0, 8) + ' = ANY(l.allowed_channels)', {
        ['plat_' + ch.id.slice(0, 8)]: ch.platform.toLowerCase(),
      });
      qb.andWhere(':reg_' + ch.id.slice(0, 8) + ' = ANY(l.allowed_regions)', {
        ['reg_' + ch.id.slice(0, 8)]: (ch.region ?? 'KR').toUpperCase(),
      });
    }

    const rows = await qb.getMany();
    return rows.filter((a) => passesExclude(a.attributes, order.assetFilter));
  }

  private async usageCounts(assetIds: string[]): Promise<Map<string, number>> {
    if (!assetIds.length) return new Map();
    const rows = await this.ds
      .getRepository(AssetUsage)
      .createQueryBuilder('u')
      .select('u.asset_id', 'assetId')
      .addSelect('COUNT(*)', 'count')
      .where('u.asset_id = ANY(:ids)', { ids: assetIds })
      .groupBy('u.asset_id')
      .getRawMany<{ assetId: string; count: string }>();
    return new Map(rows.map((r) => [r.assetId, Number(r.count)]));
  }
}
