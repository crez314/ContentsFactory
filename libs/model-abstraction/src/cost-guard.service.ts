import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Agent, CostLog } from '@cf/domain';
import { createLogger } from '@cf/common';
import type { JobCtx } from './contracts';
import { NotifierService } from './notifier.service';

/**
 * §9.4 비용 제어.
 * 예산 소진 시 에이전트를 PAUSED_BUDGET 으로 전환하고 즉시 에스컬레이션한다 (§3.4).
 */
@Injectable()
export class CostGuardService {
  private readonly WARN_RATIO = 0.8;
  private readonly log = createLogger('cost-guard');

  constructor(
    private readonly ds: DataSource,
    private readonly notifier: NotifierService,
  ) {}

  private async dailyBudget(agentId: string): Promise<number> {
    const agent = await this.ds.getRepository(Agent).findOne({ where: { id: agentId } });
    return agent?.dailyBudget ?? 0;
  }

  async spentToday(agentId: string): Promise<number> {
    const { sum } = await this.ds
      .getRepository(CostLog)
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.cost_krw), 0)', 'sum')
      .where('c.agent_id = :agentId', { agentId })
      .andWhere("c.occurred_at >= date_trunc('day', now())")
      .getRawOne<{ sum: string }>() ?? { sum: '0' };
    return Number(sum);
  }

  async spentThisMonth(agentId: string): Promise<number> {
    const { sum } = await this.ds
      .getRepository(CostLog)
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.cost_krw), 0)', 'sum')
      .where('c.agent_id = :agentId', { agentId })
      .andWhere("c.occurred_at >= date_trunc('month', now())")
      .getRawOne<{ sum: string }>() ?? { sum: '0' };
    return Number(sum);
  }

  /** 예산이 0 이면 무제한으로 본다 (로컬·테스트 편의). */
  async canSpend(agentId: string | null | undefined, amountKrw: number): Promise<boolean> {
    if (!agentId) return true;
    const [budget, spent] = await Promise.all([this.dailyBudget(agentId), this.spentToday(agentId)]);
    if (budget <= 0) return true;
    if (spent + amountKrw > budget) {
      await this.ds.getRepository(Agent).update(agentId, { lifecycle: 'PAUSED_BUDGET' });
      await this.notifier.alert('budget_exhausted', { agentId, budget, spent, requested: amountKrw });
      this.log.warn('budget exhausted', { agentId, budget, spent, requested: amountKrw });
      return false;
    }
    return true;
  }

  async record(ctx: JobCtx, costKrw: number, provider: string, unit = 'call', quantity = 1): Promise<void> {
    await this.ds.getRepository(CostLog).insert({
      agentId: ctx.agentId ?? null,
      contentId: ctx.contentId ?? null,
      taskId: ctx.taskId ?? null,
      provider,
      costKrw,
      unit,
      quantity,
    });

    if (!ctx.agentId) return;
    const [budget, spent] = await Promise.all([this.dailyBudget(ctx.agentId), this.spentToday(ctx.agentId)]);
    if (budget > 0 && spent >= budget * this.WARN_RATIO) {
      await this.notifier.warn('budget_80', { agentId: ctx.agentId, used: spent / budget, budget, spent });
    }
  }
}
