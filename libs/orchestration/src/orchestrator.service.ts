import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Blueprint, Content, Order, QcResult, Scene, Task,
  moduleForRetryTarget, type ScenePlan, type TaskKind,
} from '@cf/domain';
import { config, createLogger } from '@cf/common';
import { NotifierService } from '@cf/model-abstraction';
import { TaskFactory } from './task-factory.service';
import { ApprovalService } from './approval.service';

/**
 * §3.3 Orchestrator.
 * 워커는 다음 단계 큐에 직접 넣지 않는다. 결과를 DB 에 쓰고 Task 를 DONE 으로 전이시키면
 * 이 서비스가 후속 Task 를 만든다. 흐름 변경 시 워커 코드를 건드리지 않기 위한 구조다.
 */
@Injectable()
export class OrchestratorService {
  private readonly log = createLogger('orchestrator');

  constructor(
    private readonly ds: DataSource,
    private readonly tasks: TaskFactory,
    private readonly approvals: ApprovalService,
    private readonly notifier: NotifierService,
  ) {}

  async onTaskDone(taskId: string): Promise<void> {
    const task = await this.ds.getRepository(Task).findOne({ where: { id: taskId } });
    if (!task) return;
    const log = this.log.child({ taskId, kind: task.kind, orderId: task.orderId ?? undefined, contentId: task.contentId ?? undefined });

    switch (task.kind) {
      case 'SELECTION':
        await this.tasks.createTask({
          kind: 'BLUEPRINT', orderId: task.orderId, agentId: task.agentId,
          priority: task.priority, payload: { orderId: task.orderId },
        });
        break;

      case 'BLUEPRINT':
        await this.fanOutContents(task);
        break;

      case 'GENERATE_IMAGE':
        await this.tasks.createTask({
          kind: 'QC', orderId: task.orderId, contentId: task.contentId, agentId: task.agentId,
          priority: task.priority, attempt: await this.nextQcAttempt(task.contentId!),
          payload: { contentId: task.contentId },
        });
        break;

      case 'GENERATE_VIDEO':
        // 모든 Scene 이 완료되었을 때만 렌더링으로 진행한다.
        if (await this.allScenesDone(task.contentId!)) {
          await this.ds.getRepository(Content).update(task.contentId!, { status: 'RENDERING' });
          await this.tasks.createTask({
            kind: 'RENDER', orderId: task.orderId, contentId: task.contentId, agentId: task.agentId,
            priority: task.priority, payload: { contentId: task.contentId },
          });
        } else {
          log.info('waiting for remaining scenes');
        }
        break;

      case 'RENDER':
        await this.tasks.createTask({
          kind: 'QC', orderId: task.orderId, contentId: task.contentId, agentId: task.agentId,
          priority: task.priority, attempt: await this.nextQcAttempt(task.contentId!),
          payload: { contentId: task.contentId },
        });
        break;

      case 'QC':
        await this.handleQcResult(task);
        break;

      case 'PUBLISH':
        await this.finalizeOrderIfComplete(task.orderId!);
        break;
    }
  }

  /** 오더 수량 × 채널 수만큼 콘텐츠와 생성 Task 를 팬아웃한다. */
  private async fanOutContents(task: Task): Promise<void> {
    const orderId = task.orderId!;
    const order = await this.ds.getRepository(Order).findOne({ where: { id: orderId } });
    const blueprints = await this.ds.getRepository(Blueprint).find({ where: { orderId }, order: { seq: 'ASC' } });
    if (!order || !blueprints.length) {
      this.log.warn('blueprint fan-out skipped: nothing to build', { orderId });
      return;
    }

    await this.ds.getRepository(Order).update(orderId, { status: 'RUNNING' });
    const contentRepo = this.ds.getRepository(Content);

    for (const bp of blueprints) {
      // 재실행 시 중복 생성하지 않는다.
      let content = await contentRepo.findOne({ where: { blueprintId: bp.id } });
      if (!content) {
        content = await contentRepo.save(contentRepo.create({
          blueprintId: bp.id,
          orderId,
          outputType: bp.outputType,
          title: null,
          description: null,
          hashtags: [],
          status: 'PENDING',
        }));
      }

      if (bp.outputType === 'VIDEO') {
        await this.materializeScenes(content.id, bp.scenePlan);
        await contentRepo.update(content.id, { status: 'GENERATING' });
        // Scene 단위로 Task 를 나눈다. 부분 재생성이 Scene 단위로 가능해진다 (§M5 DoD).
        const scenes = await this.ds.getRepository(Scene).find({ where: { contentId: content.id }, order: { seq: 'ASC' } });
        for (const scene of scenes) {
          await this.tasks.createTask({
            kind: 'GENERATE_VIDEO', orderId, contentId: content.id, sceneId: scene.id,
            agentId: order.agentId, priority: task.priority,
            payload: { contentId: content.id, sceneId: scene.id },
          });
        }
      } else {
        await contentRepo.update(content.id, { status: 'GENERATING' });
        await this.tasks.createTask({
          kind: 'GENERATE_IMAGE', orderId, contentId: content.id,
          agentId: order.agentId, priority: task.priority,
          payload: { contentId: content.id },
        });
      }
    }
    this.log.info('contents fanned out', { orderId, blueprints: blueprints.length });
  }

  private async materializeScenes(contentId: string, plan: ScenePlan[]): Promise<void> {
    const repo = this.ds.getRepository(Scene);
    for (const p of plan) {
      const existing = await repo.findOne({ where: { contentId, seq: p.seq } });
      if (existing) continue;
      await repo.save(repo.create({
        contentId,
        seq: p.seq,
        durationMs: p.durationMs,
        sourceType: p.sourceType,
        sourceAssetId: p.sourceAssetId ?? null,
        prompt: p.prompt ?? null,
        subtitle: p.subtitle ?? null,
        status: 'PENDING',
      }));
    }
  }

  private async allScenesDone(contentId: string): Promise<boolean> {
    const rows = await this.ds.getRepository(Scene).find({ where: { contentId } });
    return rows.length > 0 && rows.every((s) => s.status === 'DONE');
  }

  private async nextQcAttempt(contentId: string): Promise<number> {
    return (await this.ds.getRepository(QcResult).count({ where: { contentId } })) + 1;
  }

  /** §3.3 QC 결과에 따라 승인·부분재생성·차단으로 분기한다. */
  private async handleQcResult(task: Task): Promise<void> {
    const contentId = task.contentId!;
    const qc = await this.ds.getRepository(QcResult).findOne({ where: { contentId }, order: { attempt: 'DESC' } });
    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    if (!qc || !content) return;

    if (qc.verdict === 'BLOCKED') {
      await this.ds.getRepository(Content).update(contentId, { status: 'BLOCKED' });
      await this.notifier.escalate('policy_or_copyright_violation', {
        taskId: task.id, contentId, violations: qc.violations,
      });
      await this.finalizeOrderIfComplete(task.orderId!);
      return;
    }

    if (qc.verdict === 'FAIL') {
      const attempts = await this.ds.getRepository(QcResult).count({ where: { contentId } });
      if (attempts >= config.ops.maxQcAttempts) {
        await this.ds.getRepository(Content).update(contentId, { status: 'QC_FAILED' });
        await this.notifier.escalate('qc_retry_exhausted', { taskId: task.id, contentId, attempts });
        await this.finalizeOrderIfComplete(task.orderId!);
        return;
      }

      // 최저 점수 영역에 대응하는 모듈만 재실행한다.
      const kind = moduleForRetryTarget(qc.retryTarget, content.outputType as 'IMAGE' | 'VIDEO') as TaskKind;
      const nextStatus = kind === 'RENDER' ? 'RENDERING' : 'GENERATING';
      await this.ds.getRepository(Content).update(contentId, { status: nextStatus });

      if (kind === 'GENERATE_VIDEO') {
        // 영상은 Scene 을 다시 열어야 재생성이 일어난다.
        await this.ds.getRepository(Scene).update({ contentId }, { status: 'PENDING' });
        const scenes = await this.ds.getRepository(Scene).find({ where: { contentId }, order: { seq: 'ASC' } });
        for (const scene of scenes) {
          await this.tasks.createTask({
            kind, orderId: task.orderId, contentId, sceneId: scene.id, agentId: task.agentId,
            priority: 1, attempt: attempts + 1,
            payload: { contentId, sceneId: scene.id, retryTarget: qc.retryTarget },
          });
        }
      } else {
        await this.tasks.createTask({
          kind, orderId: task.orderId, contentId, agentId: task.agentId,
          priority: 1, attempt: attempts + 1,
          payload: { contentId, retryTarget: qc.retryTarget },
        });
      }
      this.log.info('qc failed, partial regeneration scheduled', {
        contentId, retryTarget: qc.retryTarget, kind, attempt: attempts + 1,
      });
      return;
    }

    // PASS → 승인 판정
    await this.approvals.decide(contentId);
    await this.finalizeOrderIfComplete(task.orderId!);
  }

  /** 오더의 모든 콘텐츠가 종료 상태면 DONE / PARTIAL 로 마감한다. */
  async finalizeOrderIfComplete(orderId: string): Promise<void> {
    if (!orderId) return;
    const contents = await this.ds.getRepository(Content).find({ where: { orderId } });
    if (!contents.length) return;

    const terminal = ['PUBLISHED', 'BLOCKED', 'FAILED', 'REJECTED', 'QC_FAILED'];
    if (!contents.every((c) => terminal.includes(c.status))) return;

    const succeeded = contents.filter((c) => c.status === 'PUBLISHED').length;
    const status = succeeded === contents.length ? 'DONE' : succeeded > 0 ? 'PARTIAL' : 'PARTIAL';
    await this.ds.getRepository(Order).update(orderId, { status });
    this.log.info('order finalized', { orderId, status, succeeded, total: contents.length });
  }
}
