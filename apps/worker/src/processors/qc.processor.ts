import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Content, Order, QcResult } from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { QcHandoff, type JobEnvelope } from '@cf/queue';
import { NotifierService, type JobCtx } from '@cf/model-abstraction';
import { QcEngineService } from '../qc/qc-engine.service';
import type { TaskProcessor } from './processor.registry';

@Injectable()
export class QcProcessor implements TaskProcessor {
  private readonly log = createLogger('qc-processor');

  constructor(
    private readonly ds: DataSource,
    private readonly engine: QcEngineService,
    private readonly notifier: NotifierService,
  ) {}

  async process(envelope: JobEnvelope): Promise<QcHandoff> {
    const contentId = envelope.contentId!;
    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const order = await this.ds.getRepository(Order).findOne({ where: { id: content.orderId } });
    await this.ds.getRepository(Content).update(contentId, { status: 'QC' });

    const ctx: JobCtx = {
      taskId: envelope.taskId, orderId: content.orderId, contentId, agentId: order?.agentId ?? null,
    };

    const repo = this.ds.getRepository(QcResult);
    // attempt 는 봉투가 아니라 실제 저장된 횟수를 기준으로 잡는다.
    const attempt = (await repo.count({ where: { contentId } })) + 1;
    const evaluation = await this.engine.evaluate(contentId, ctx);

    await repo.save(repo.create({
      contentId,
      attempt,
      totalScore: evaluation.totalScore,
      verdict: evaluation.verdict,
      areaScores: evaluation.areaScores,
      violations: evaluation.violations,
      retryTarget: evaluation.retryTarget,
    }));

    if (evaluation.verdict === 'BLOCKED') {
      // §9.3 QC BLOCKED 는 심각 등급 알림
      await this.notifier.alert('qc_blocked', {
        contentId, attempt, violations: evaluation.violations,
      });
    }

    const handoff: QcHandoff = {
      contentId,
      attempt,
      verdict: evaluation.verdict,
      totalScore: evaluation.totalScore,
      retryTarget: evaluation.retryTarget,
    };
    QcHandoff.parse(handoff);
    this.log.info('qc recorded', { contentId, attempt, verdict: evaluation.verdict, totalScore: evaluation.totalScore });
    return handoff;
  }
}
