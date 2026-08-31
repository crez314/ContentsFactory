import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import type { Request } from 'express';
import { CreateAgentDto, UpdateAgentDto } from '@cf/contracts';
import { Agent, Approval, Content, CostLog, Order, QcResult } from '@cf/domain';
import { AppError, CurrentUser, MinRole, type AuthUser } from '@cf/common';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';

@ApiTags('agents')
@Controller('agents')
export class AgentController {
  constructor(private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Get()
  list() {
    return this.ds.getRepository(Agent).find({ order: { createdAt: 'ASC' } });
  }

  @Post()
  @MinRole('ADMIN')
  create(@Body(zodBody(CreateAgentDto)) dto: z.infer<typeof CreateAgentDto>) {
    const repo = this.ds.getRepository(Agent);
    return repo.save(repo.create({ ...dto, lifecycle: 'CONFIGURED' }));
  }

  @Patch(':id')
  @MinRole('ADMIN')
  @ApiOperation({ summary: '프로필·예산·승인레벨 수정' })
  async update(
    @Param('id') id: string,
    @Body(zodBody(UpdateAgentDto)) dto: z.infer<typeof UpdateAgentDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const repo = this.ds.getRepository(Agent);
    const agent = await repo.findOne({ where: { id } });
    if (!agent) throw new AppError('NOT_FOUND', { message: '에이전트를 찾을 수 없습니다.' });

    const before = { approvalLevel: agent.approvalLevel, dailyBudget: agent.dailyBudget, lifecycle: agent.lifecycle };
    Object.assign(agent, dto);
    await repo.save(agent);
    await this.audit.record({
      actor, action: 'AGENT_UPDATE', targetType: 'agent', targetId: id,
      before, after: { approvalLevel: agent.approvalLevel, dailyBudget: agent.dailyBudget, lifecycle: agent.lifecycle },
      ip: req.ip,
    });
    return agent;
  }

  /**
   * §4.7 실적 지표.
   * V1 에서는 집계만 하고 승인 레벨 자동 상향은 V2 에서 이 값을 쓴다.
   */
  @Get(':id/stats')
  @ApiOperation({ summary: '실적 지표 (V2 승인레벨 자동상향의 입력)' })
  async stats(@Param('id') id: string) {
    const agent = await this.ds.getRepository(Agent).findOne({ where: { id } });
    if (!agent) throw new AppError('NOT_FOUND', { message: '에이전트를 찾을 수 없습니다.' });

    const orderIds = (await this.ds.getRepository(Order).find({ where: { agentId: id }, select: { id: true } })).map((o) => o.id);

    const [spentToday, spentMonth] = await Promise.all([
      this.sum(id, "date_trunc('day', now())"),
      this.sum(id, "date_trunc('month', now())"),
    ]);

    if (!orderIds.length) {
      return {
        agent, spentToday, spentMonth,
        dailyRemaining: Math.max(0, agent.dailyBudget - spentToday),
        contentCount: 0, publishedCount: 0, blockedCount: 0,
        autoApprovedRatio: 0, avgQcScore: null, qcPassRate: null,
      };
    }

    const contents = await this.ds.getRepository(Content).find({ where: orderIds.map((orderId) => ({ orderId })) });
    const contentIds = contents.map((c) => c.id);

    const qcRows = contentIds.length
      ? await this.ds.getRepository(QcResult).find({ where: contentIds.map((contentId) => ({ contentId })) })
      : [];
    const approvals = contentIds.length
      ? await this.ds.getRepository(Approval).find({ where: contentIds.map((contentId) => ({ contentId })) })
      : [];

    const latestByContent = new Map<string, QcResult>();
    for (const q of qcRows) {
      const prev = latestByContent.get(q.contentId);
      if (!prev || q.attempt > prev.attempt) latestByContent.set(q.contentId, q);
    }
    const latest = [...latestByContent.values()];

    return {
      agent,
      spentToday,
      spentMonth,
      dailyRemaining: Math.max(0, agent.dailyBudget - spentToday),
      contentCount: contents.length,
      publishedCount: contents.filter((c) => c.status === 'PUBLISHED').length,
      blockedCount: contents.filter((c) => c.status === 'BLOCKED').length,
      autoApprovedRatio: approvals.length
        ? approvals.filter((a) => a.auto && a.decision === 'APPROVED').length / approvals.length
        : 0,
      avgQcScore: latest.length ? latest.reduce((s, q) => s + q.totalScore, 0) / latest.length : null,
      qcPassRate: latest.length ? latest.filter((q) => q.verdict === 'PASS').length / latest.length : null,
    };
  }

  private async sum(agentId: string, since: string): Promise<number> {
    const row = await this.ds
      .getRepository(CostLog)
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.cost_krw), 0)', 'sum')
      .where('c.agent_id = :agentId', { agentId })
      .andWhere(`c.occurred_at >= ${since}`)
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }
}
