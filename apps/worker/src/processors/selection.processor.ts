import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Asset, AssetUsage, CoverageGap, Order, Selection,
  MIN_FIT, diversify, eligibility, fitScore,
  type EligibilityRequirement, type IneligibleReason, type QualityGrade, type Ranked,
} from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { SelectionResult, type JobEnvelope } from '@cf/queue';
import type { TaskProcessor } from './processor.registry';

interface Scored {
  asset: Asset;
  score: number;
  breakdown: ReturnType<typeof fitScore>['breakdown'];
}

/**
 * §4.3 Selection Module (명세 v1.1).
 *
 * 라이선스·정책은 점수가 아니라 사전 필터다. 통과하지 못한 자산은 점수 계산조차 하지 않는다.
 * 통과 자산이 없으면 생성 비용이 발생하기 전에 오더를 반려하고,
 * 최고점이 MIN_FIT 미만이면 실패가 아니라 촬영 계획의 입력(coverage_gaps)으로 기록한다.
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

    const pool = await this.candidatePool(order);
    const req = this.requirement(order);

    // ── 1) 사전 필터
    const eligible: Asset[] = [];
    const rejectionTally: Partial<Record<IneligibleReason, number>> = {};
    for (const asset of pool) {
      const verdict = eligibility(
        {
          attributes: asset.attributes,
          qualityGrade: asset.qualityGrade,
          licenses: (asset.licenses ?? []).map((l) => ({
            allowedChannels: l.allowedChannels,
            allowedRegions: l.allowedRegions,
            derivativeLevel: l.derivativeLevel,
            validFrom: l.validFrom,
            validUntil: l.validUntil,
          })),
        },
        req,
      );
      if (verdict.ok) eligible.push(asset);
      else for (const r of verdict.reasons) rejectionTally[r] = (rejectionTally[r] ?? 0) + 1;
    }

    if (!eligible.length) {
      // 생성 비용이 발생하기 전에 반려한다.
      this.log.warn('no eligible asset', { orderId, poolSize: pool.length, rejectionTally });
      await this.recordGap(order, null, null, 'NO_ELIGIBLE_ASSET');
      throw new AppError('SELECTION_NO_ELIGIBLE_ASSET', {
        details: [{ orderId, poolSize: pool.length, rejections: rejectionTally }],
      });
    }

    // ── 2) 점수
    const usage = await this.usageCounts(eligible.map((a) => a.id));
    const scored: Scored[] = eligible
      .map((asset) => {
        const { score, breakdown } = fitScore(
          {
            attributes: asset.attributes,
            qualityGrade: asset.qualityGrade,
            shotAt: asset.shotAt,
            usageCount: usage.get(asset.id) ?? 0,
          },
          order.assetFilter,
        );
        return { asset, score, breakdown };
      })
      .sort((a, b) => b.score - a.score);

    // ── 3) 최저 적합도
    if (scored[0].score < MIN_FIT) {
      this.log.warn('coverage insufficient', { orderId, bestScore: scored[0].score, minFit: MIN_FIT });
      await this.recordGap(order, scored[0].score, scored[0].asset.id, 'INSUFFICIENT_COVERAGE');
      throw new AppError('SELECTION_INSUFFICIENT_COVERAGE', {
        details: [{ orderId, bestFitScore: scored[0].score, minFit: MIN_FIT, requested: order.assetFilter.include ?? {} }],
      });
    }

    // ── 4) 동일 촬영 세션 편중 완화 후 상위 k
    const k = Math.min(scored.length, Math.max(8, order.quantity * (order.channels?.length ?? 1) * 3));
    const ranked: Array<Ranked<Scored>> = scored.slice(0, k * 3).map((s) => ({
      item: s,
      score: s.score,
      // 스키마에 촬영 세션 ID 가 없어 촬영일을 세션 대용치로 쓴다.
      sessionKey: s.asset.shotAt ?? 'unknown',
    }));
    const chosen = diversify(ranked, k).map((r) => r.item);

    // ── 5) 저장
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
            licenseOk: true, // 사전 필터를 통과했으므로 항상 참이다
            validUntil: this.effectiveValidUntil(s.asset, req.publishDate),
            breakdown: {
              attrMatch: s.breakdown.attrMatch,
              quality: s.breakdown.quality,
              freshness: s.breakdown.freshness,
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
        reason: {
          matched: s.breakdown.matched,
          licenseOk: true,
          validUntil: this.effectiveValidUntil(s.asset, req.publishDate),
        },
      })),
    };
    SelectionResult.parse(result);

    this.log.info('selection completed', {
      orderId,
      pool: pool.length,
      eligible: eligible.length,
      selected: chosen.length,
      topScore: chosen[0].score,
      sessions: new Set(chosen.map((c) => c.asset.shotAt)).size,
    });
    return result;
  }

  /** 사전 필터에 넘길 오더 쪽 요구사항 */
  private requirement(order: Order): EligibilityRequirement {
    return {
      channels: (order.channels ?? []).map((c) => ({
        platform: c.platform.toLowerCase(),
        region: (c.region ?? 'KR').toUpperCase(),
      })),
      publishDate: (order.scheduledAt ?? new Date()).toISOString().slice(0, 10),
      derivativeLevel: order.derivativeLevel,
      allowedGrades: (order.allowedGrades ?? []) as QualityGrade[],
      assetFilter: order.assetFilter,
    };
  }

  /**
   * 후보 풀 — include 속성 필터까지만 DB 에서 좁힌다.
   * 라이선스 조건은 eligible() 이 판정하므로 여기서 join 으로 걸러내지 않는다.
   * 그래야 어떤 사유로 몇 건이 떨어졌는지 집계해 로그와 반려 사유에 남길 수 있다.
   */
  private async candidatePool(order: Order): Promise<Asset[]> {
    const qb = this.ds
      .getRepository(Asset)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.licenses', 'l')
      .where('a.artist_id = :artistId', { artistId: order.artistId })
      .andWhere("a.status = 'ACTIVE'")
      .andWhere('a.deleted_at IS NULL');

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
    return qb.getMany();
  }

  /** 게시 시점에 유효한 라이선스 중 가장 늦게 만료되는 날짜 */
  private effectiveValidUntil(asset: Asset, publishDate: string): string {
    const valid = (asset.licenses ?? [])
      .filter((l) => l.validFrom <= publishDate && publishDate <= l.validUntil)
      .map((l) => l.validUntil)
      .sort();
    return valid[valid.length - 1] ?? publishDate;
  }

  /** 실패가 아니라 촬영 계획의 입력으로 남긴다 (§4.3). */
  private async recordGap(
    order: Order,
    bestFitScore: number | null,
    bestAssetId: string | null,
    reason: string,
  ): Promise<void> {
    const repo = this.ds.getRepository(CoverageGap);
    await repo.save(
      repo.create({
        orderId: order.id,
        artistId: order.artistId,
        requestedAttributes: (order.assetFilter.include ?? {}) as Record<string, never>,
        bestFitScore,
        bestAssetId,
        reason,
      }),
    );
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
