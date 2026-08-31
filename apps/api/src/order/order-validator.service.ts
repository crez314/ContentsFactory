import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Agent, Asset, AssetUsage, CostLog, MasterBannedTerm, Order,
  estimateCost, passesExclude, type ValidationError, type ValidationResult,
} from '@cf/domain';
import { AppError, config, createLogger } from '@cf/common';
import { MODEL_PRICING } from './pricing';

/**
 * §4.2 Order Validator.
 * 10개 항목을 순서대로 수행한다. 앞 단계가 실패하면 뒤 단계는 판단 자체가 무의미하므로
 * 그 지점에서 중단하고 지금까지의 실패를 돌려준다.
 */
@Injectable()
export class OrderValidatorService {
  private readonly log = createLogger('order-validator');

  constructor(private readonly ds: DataSource) {}

  async validate(orderId: string): Promise<ValidationResult> {
    const order = await this.ds.getRepository(Order).findOne({
      where: { id: orderId },
      relations: { artist: true, channels: true, agent: true },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND');

    const errors: ValidationError[] = [];
    const channels = order.channels ?? [];
    const publishAt = order.scheduledAt ?? new Date();
    const publishDate = publishAt.toISOString().slice(0, 10);

    // 1) 아티스트 상태
    if (order.artist?.status !== 'ACTIVE') {
      errors.push({ code: 'ARTIST_INACTIVE', detail: { artistId: order.artistId, status: order.artist?.status } });
      return this.fail(errors, 0, 0);
    }

    // 2) 대상 채널 상태
    const inactive = channels.filter((c) => c.status !== 'ACTIVE');
    if (!channels.length || inactive.length) {
      errors.push({
        code: 'CHANNEL_INACTIVE',
        detail: channels.length
          ? { channels: inactive.map((c) => ({ handle: c.handle, status: c.status })) }
          : { reason: '대상 채널이 지정되지 않았습니다.' },
      });
      return this.fail(errors, 0, 0);
    }

    // 3) 채널 규격 부합 (화면비·길이)
    for (const ch of channels) {
      if (ch.spec.aspect && order.spec.aspect && ch.spec.aspect !== order.spec.aspect) {
        errors.push({
          code: 'SPEC_MISMATCH',
          detail: { channel: ch.handle, expected: ch.spec.aspect, actual: order.spec.aspect, field: 'aspect' },
        });
      }
      const wantsVideo = order.outputType === 'VIDEO' || order.outputType === 'BOTH';
      if (wantsVideo && ch.spec.maxDurationSec && (order.spec.durationSec ?? 0) > ch.spec.maxDurationSec) {
        errors.push({
          code: 'SPEC_MISMATCH',
          detail: { channel: ch.handle, maxDurationSec: ch.spec.maxDurationSec, actual: order.spec.durationSec, field: 'duration' },
        });
      }
    }
    if (errors.length) return this.fail(errors, 0, 0);

    // 4) 후보 자산 수량
    const candidates = await this.findCandidates(order);
    const minRequired = Math.max(config.ops.minCandidateAssets, Math.ceil(order.quantity * 1.5));
    if (candidates.length < minRequired) {
      errors.push({
        code: 'INSUFFICIENT_ASSETS',
        detail: { found: candidates.length, required: minRequired },
      });
      return this.fail(errors, 0, candidates.length);
    }

    // 5) 채널·지역 허용
    for (const ch of channels) {
      const platform = ch.platform.toLowerCase();
      const region = (ch.region ?? 'KR').toUpperCase();
      const usable = candidates.filter((a) =>
        (a.licenses ?? []).some(
          (l) => l.allowedChannels.includes(platform) && l.allowedRegions.includes(region),
        ),
      );
      if (usable.length === 0) {
        errors.push({
          code: 'LICENSE_CHANNEL_DENIED',
          detail: { channel: ch.handle, reason: `region ${region} not allowed`, platform },
        });
      }
    }

    // 6) 라이선스 유효기간이 게시 예정일 이후인가
    const validAtPublish = candidates.filter((a) =>
      (a.licenses ?? []).some((l) => l.validUntil >= publishDate && l.validFrom <= publishDate),
    );
    if (validAtPublish.length < minRequired) {
      errors.push({
        code: 'LICENSE_EXPIRED',
        detail: { publishDate, validCount: validAtPublish.length, required: minRequired },
      });
    }

    // 7) 2차 가공 허용
    const derivativeOk = candidates.filter((a) => (a.licenses ?? []).some((l) => l.derivativeAllowed));
    if (derivativeOk.length < minRequired) {
      errors.push({
        code: 'DERIVATIVE_DENIED',
        detail: { allowed: derivativeOk.length, required: minRequired },
      });
    }
    if (errors.length) return this.fail(errors, 0, candidates.length);

    // 8) 오더 예산 상한
    const estimate = estimateCost(
      { outputType: order.outputType, quantity: order.quantity, channelCount: channels.length, spec: order.spec },
      MODEL_PRICING,
    );
    if (order.budgetCap > 0 && estimate.totalKrw > order.budgetCap) {
      errors.push({
        code: 'BUDGET_EXCEEDED',
        detail: { estimated: estimate.totalKrw, cap: order.budgetCap, breakdown: estimate.breakdown },
      });
    }

    // 9) 에이전트 일일 잔여 예산
    if (order.agentId) {
      const agent = order.agent ?? (await this.ds.getRepository(Agent).findOne({ where: { id: order.agentId } }));
      if (agent && agent.dailyBudget > 0) {
        const spent = await this.spentToday(agent.id);
        const remaining = agent.dailyBudget - spent;
        if (estimate.totalKrw > remaining) {
          errors.push({
            code: 'AGENT_BUDGET_EXCEEDED',
            detail: { estimated: estimate.totalKrw, remaining, dailyBudget: agent.dailyBudget, spent },
          });
        }
      }
      if (agent && !['ACTIVE', 'TEST'].includes(agent.lifecycle)) {
        errors.push({
          code: 'AGENT_BUDGET_EXCEEDED',
          detail: { reason: `agent lifecycle is ${agent.lifecycle}`, agentId: agent.id },
        });
      }
    }

    // 10) 금지 주제·브랜드 정책
    const policyHits = await this.checkPolicy(order);
    if (policyHits.length) {
      errors.push({ code: 'POLICY_VIOLATION', detail: { terms: policyHits } });
    }

    if (errors.length) return this.fail(errors, estimate.totalKrw, candidates.length);

    this.log.info('order validated', { orderId, estimatedCostKrw: estimate.totalKrw, candidateCount: candidates.length });
    return { ok: true, errors: [], estimatedCostKrw: estimate.totalKrw, candidateCount: candidates.length };
  }

  /** 오더 필터에 부합하고 라이선스가 붙어 있는 활성 자산 */
  async findCandidates(order: Order): Promise<Asset[]> {
    const qb = this.ds
      .getRepository(Asset)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.licenses', 'l')
      .where('a.artist_id = :artistId', { artistId: order.artistId })
      .andWhere("a.status = 'ACTIVE'")
      .andWhere('a.deleted_at IS NULL');

    const include = order.assetFilter.include ?? {};
    let i = 0;
    for (const [attr, values] of Object.entries(include)) {
      if (!values?.length) continue;
      const clauses = values.map((v, j) => {
        const p = `inc${i}_${j}`;
        qb.setParameter(p, JSON.stringify({ [attr]: v }));
        return `a.attributes @> :${p}::jsonb`;
      });
      qb.andWhere(`(${clauses.join(' OR ')})`);
      i += 1;
    }

    const rows = await qb.getMany();
    // exclude 는 후보에서 완전히 제거한다 (§4.3)
    return rows.filter((a) => passesExclude(a.attributes, order.assetFilter));
  }

  private async spentToday(agentId: string): Promise<number> {
    const row = await this.ds
      .getRepository(CostLog)
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.cost_krw), 0)', 'sum')
      .where('c.agent_id = :agentId', { agentId })
      .andWhere("c.occurred_at >= date_trunc('day', now())")
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  /** 오더의 컨셉·디자인 텍스트에 금지어가 있는지 본다. */
  private async checkPolicy(order: Order): Promise<Array<{ term: string; severity: string }>> {
    const terms = await this.ds.getRepository(MasterBannedTerm).find();
    const haystack = JSON.stringify({ concept: order.concept, design: order.design }).toLowerCase();
    return terms
      .filter((t) => haystack.includes(t.term.toLowerCase()))
      .map((t) => ({ term: t.term, severity: t.severity }));
  }

  private fail(errors: ValidationError[], estimatedCostKrw: number, candidateCount: number): ValidationResult {
    return { ok: false, errors, estimatedCostKrw, candidateCount };
  }

  /**
   * §7.2 오더 생성 5단계의 실시간 후보 수 표시.
   * 이것이 없으면 제출 후 INSUFFICIENT_ASSETS 로 반려되는 일이 반복된다.
   */
  async previewCandidates(args: {
    artistId: string;
    assetFilter: Order['assetFilter'];
    channelIds: string[];
    scheduledAt?: string | null;
  }): Promise<{ total: number; byChannel: Array<{ channelId: string; usable: number }>; sample: string[] }> {
    const fake = { artistId: args.artistId, assetFilter: args.assetFilter } as Order;
    const candidates = await this.findCandidates(fake);
    const publishDate = (args.scheduledAt ? new Date(args.scheduledAt) : new Date()).toISOString().slice(0, 10);

    const channels = args.channelIds.length
      ? await this.ds.query<Array<{ id: string; platform: string; region: string | null }>>(
          'SELECT id, platform, region FROM channels WHERE id = ANY($1)',
          [args.channelIds],
        )
      : [];

    const byChannel = channels.map((ch) => ({
      channelId: ch.id,
      usable: candidates.filter((a) =>
        (a.licenses ?? []).some(
          (l) =>
            l.allowedChannels.includes(ch.platform.toLowerCase()) &&
            l.allowedRegions.includes((ch.region ?? 'KR').toUpperCase()) &&
            l.derivativeAllowed &&
            l.validUntil >= publishDate,
        ),
      ).length,
    }));

    return { total: candidates.length, byChannel, sample: candidates.slice(0, 12).map((a) => a.id) };
  }
}
