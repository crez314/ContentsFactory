import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Agent, Approval, Content, Order, Publication, QcResult,
  canTransitionContent, shouldAutoApprove, violatesFourEyes,
} from '@cf/domain';
import { AppError, createLogger, type AuthUser } from '@cf/common';
import { TaskFactory } from './task-factory.service';

/**
 * §4.7 Approval Module.
 * QC 통과 후 에이전트 승인 레벨에 따라 자동 승인하거나 승인 대기열(READY)로 보낸다.
 */
@Injectable()
export class ApprovalService {
  private readonly log = createLogger('approval');

  constructor(private readonly ds: DataSource, private readonly tasks: TaskFactory) {}

  /** 승인 레벨 판정의 기준. 오더에 에이전트가 없으면 오더 자체의 레벨을 쓴다. */
  private async approvalLevelFor(content: Content): Promise<number> {
    const order = await this.ds.getRepository(Order).findOne({ where: { id: content.orderId } });
    if (!order) return 0;
    if (order.agentId) {
      const agent = await this.ds.getRepository(Agent).findOne({ where: { id: order.agentId } });
      if (agent) return agent.approvalLevel;
    }
    return order.approvalLevel;
  }

  /** QC PASS 직후 오케스트레이터가 호출한다. */
  async decide(contentId: string): Promise<{ auto: boolean; status: Content['status'] }> {
    const repo = this.ds.getRepository(Content);
    const content = await repo.findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const qc = await this.latestQc(contentId);
    if (!qc) throw new AppError('CONTENT_INVALID_STATE', { message: 'QC 결과가 없습니다.' });

    if (qc.verdict === 'BLOCKED') {
      await this.setStatus(contentId, 'BLOCKED');
      return { auto: false, status: 'BLOCKED' };
    }

    const level = await this.approvalLevelFor(content);
    const auto = shouldAutoApprove(level, qc);

    if (auto) {
      await this.ds.getRepository(Approval).insert({
        contentId, decision: 'APPROVED', auto: true, levelAt: level, decidedBy: null,
      });
      await this.setStatus(contentId, 'APPROVED');
      await this.enqueuePublish(content);
      this.log.info('content auto-approved', { contentId, level, totalScore: qc.totalScore });
      return { auto: true, status: 'APPROVED' };
    }

    await this.setStatus(contentId, 'READY'); // 승인 대기열
    this.log.info('content queued for manual approval', { contentId, level, totalScore: qc.totalScore });
    return { auto: false, status: 'READY' };
  }

  /** 백오피스에서의 수동 승인. §6.2 4-eyes 원칙을 여기서 강제한다. */
  async approve(contentId: string, actor: AuthUser, comment?: string) {
    const repo = this.ds.getRepository(Content);
    const content = await repo.findOne({ where: { id: contentId }, relations: { order: true } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');
    if (!canTransitionContent(content.status, 'APPROVED')) {
      throw new AppError('CONTENT_INVALID_STATE', { details: [{ from: content.status, to: 'APPROVED' }] });
    }
    if (violatesFourEyes({
      orderRequestedBy: content.order!.requestedBy,
      actorId: actor.id,
      actorRole: actor.role,
    })) {
      throw new AppError('SELF_APPROVAL_DENIED');
    }

    const level = await this.approvalLevelFor(content);
    await this.ds.getRepository(Approval).insert({
      contentId, decision: 'APPROVED', auto: false, levelAt: level, decidedBy: actor.id, comment: comment ?? null,
    });
    await this.setStatus(contentId, 'APPROVED');
    await this.enqueuePublish(content);
    return repo.findOne({ where: { id: contentId } });
  }

  async reject(contentId: string, actor: AuthUser, comment?: string) {
    const repo = this.ds.getRepository(Content);
    const content = await repo.findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');
    if (!canTransitionContent(content.status, 'REJECTED')) {
      throw new AppError('CONTENT_INVALID_STATE', { details: [{ from: content.status, to: 'REJECTED' }] });
    }

    const level = await this.approvalLevelFor(content);
    await this.ds.getRepository(Approval).insert({
      contentId, decision: 'REJECTED', auto: false, levelAt: level, decidedBy: actor.id, comment: comment ?? null,
    });
    await this.setStatus(contentId, 'REJECTED');
    return repo.findOne({ where: { id: contentId } });
  }

  /** 승인된 콘텐츠를 오더가 지정한 모든 채널에 게시하도록 Task 를 만든다. */
  private async enqueuePublish(content: Content): Promise<void> {
    const order = await this.ds.getRepository(Order).findOne({
      where: { id: content.orderId },
      relations: { channels: true },
    });
    if (!order?.channels?.length) return;

    // 블루프린트가 특정 채널을 겨냥하므로 그 채널만 게시한다.
    const blueprintChannel = await this.ds.query<Array<{ channel_id: string }>>(
      'SELECT channel_id FROM blueprints WHERE id = $1',
      [content.blueprintId],
    );
    const channelId = blueprintChannel[0]?.channel_id;
    if (!channelId) return;

    // 이미 게시된 채널이면 다시 만들지 않는다 (§3.5 publications 유니크 제약과 짝을 이룬다).
    const existing = await this.ds.getRepository(Publication).findOne({
      where: { contentId: content.id, channelId },
    });
    if (existing && ['UPLOADED', 'PUBLISHED'].includes(existing.status)) return;

    await this.tasks.createTask({
      kind: 'PUBLISH',
      orderId: content.orderId,
      contentId: content.id,
      agentId: order.agentId,
      priority: 2,
      payload: { contentId: content.id, channelId },
    });
  }

  async latestQc(contentId: string): Promise<QcResult | null> {
    return this.ds.getRepository(QcResult).findOne({ where: { contentId }, order: { attempt: 'DESC' } });
  }

  private async setStatus(contentId: string, status: Content['status']): Promise<void> {
    await this.ds.getRepository(Content).update(contentId, { status });
  }
}
