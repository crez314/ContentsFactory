import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Agent, Channel, Content, Order, Scene, Task } from '@cf/domain';
import { backoffMs, config, createLogger, type FailureClass } from '@cf/common';
import { NotifierService } from '@cf/model-abstraction';
import { TaskFactory } from '@cf/orchestration';

/**
 * §3.4 재시도·Fallback·에스컬레이션.
 *
 *  TRANSIENT           지수 백오프 재시도 (2s → 8s → 32s)
 *  BACKEND_UNAVAILABLE 다음 어댑터로 Fallback, 재시도 횟수 1 증가
 *  BUDGET_EXCEEDED     에이전트 PAUSED_BUDGET 전환, 즉시 에스컬레이션
 *  POLICY_VIOLATION    재시도 없음, 콘텐츠 BLOCKED, 즉시 에스컬레이션
 *  INVALID_INPUT       재시도 없음, Task FAILED
 *  RETRY_EXHAUSTED     Task ESCALATED, 백오피스 알림
 */
/** 이월 상한. 하루치 슬롯을 넘겨도 못 나가면 사람을 부른다. */
const MAX_DEFERRALS = 24;

@Injectable()
export class FailureHandlerService {
  private readonly log = createLogger('failure-handler');

  constructor(
    private readonly ds: DataSource,
    private readonly tasks: TaskFactory,
    private readonly notifier: NotifierService,
  ) {}

  async handle(taskId: string, failureClass: FailureClass, error: unknown): Promise<void> {
    const repo = this.ds.getRepository(Task);
    const task = await repo.findOne({ where: { id: taskId } });
    if (!task) return;

    const log = this.log.child({
      taskId, kind: task.kind, contentId: task.contentId ?? undefined, orderId: task.orderId ?? undefined,
    });

    switch (failureClass) {
      /**
       * §4.9 이월 — 실패가 아니다.
       * 재시도 예산을 쓰지 않고 다음 게시 슬롯에 다시 넣는다.
       * 콘텐츠 상태도 건드리지 않는다 (게시 처리기가 이미 APPROVED 로 되돌려 놓았다).
       */
      case 'DEFERRED': {
        const deferrals = Number(task.payload.deferrals ?? 0) + 1;
        if (deferrals > MAX_DEFERRALS) {
          await this.tasks.transition(taskId, 'ESCALATED', { reason: 'deferral_limit', error });
          await this.notifier.escalate('publish_deferral_exhausted', {
            taskId, contentId: task.contentId, deferrals,
          });
          log.error('publish deferred too many times', { deferrals });
          return;
        }

        const delayMs = await this.nextSlotDelayMs(task);
        task.payload = { ...task.payload, deferrals };
        await repo.save(task);
        await this.tasks.transition(taskId, 'RETRY', { reason: 'channel_headroom', meta: { deferrals, delayMs } });
        // SLA 는 이월분만큼 미뤄준다. 안 그러면 대기 중에 SLA 위반으로 잡힌다.
        await repo.update(taskId, { slaDeadline: new Date(Date.now() + delayMs + 600_000) });
        await this.tasks.enqueue(task, task.retryCount + 1, delayMs);
        log.info('publish deferred to next slot', { deferrals, delayMs });
        return;
      }

      case 'POLICY_VIOLATION':
        await this.tasks.transition(taskId, 'FAILED', { reason: 'policy_violation', error });
        if (task.contentId) await this.ds.getRepository(Content).update(task.contentId, { status: 'BLOCKED' });
        await this.notifier.escalate('policy_violation', { taskId, contentId: task.contentId, error });
        log.error('policy violation, content blocked');
        return;

      case 'BUDGET_EXCEEDED':
        if (task.agentId) {
          await this.ds.getRepository(Agent).update(task.agentId, { lifecycle: 'PAUSED_BUDGET' });
        }
        await this.tasks.transition(taskId, 'ESCALATED', { reason: 'budget_exceeded', error });
        await this.notifier.escalate('budget_exceeded', { taskId, agentId: task.agentId });
        await this.markContentFailed(task);
        log.error('budget exceeded, agent paused');
        return;

      case 'INVALID_INPUT':
        await this.tasks.transition(taskId, 'FAILED', { reason: 'invalid_input', error });
        await this.markContentFailed(task);
        log.warn('invalid input, no retry');
        return;

      case 'BACKEND_UNAVAILABLE':
      case 'TRANSIENT':
      case 'RETRY_EXHAUSTED':
      default: {
        if (task.retryCount >= task.maxRetry) {
          await this.tasks.transition(taskId, 'ESCALATED', { reason: 'retry_exhausted', error });
          await this.notifier.escalate('retry_exhausted', {
            taskId, kind: task.kind, retryCount: task.retryCount, maxRetry: task.maxRetry,
          });
          await this.markContentFailed(task);
          log.error('retry exhausted, escalated', { retryCount: task.retryCount });
          return;
        }

        // BACKEND_UNAVAILABLE 은 다음 어댑터로 넘어가므로 FALLBACK 으로 구분해 기록한다.
        const nextState = failureClass === 'BACKEND_UNAVAILABLE' ? 'FALLBACK' : 'RETRY';
        const attempt = task.retryCount + 1;
        task.retryCount = attempt;
        task.error = error;
        await repo.save(task);
        await this.tasks.transition(taskId, nextState, { reason: failureClass.toLowerCase(), error });

        const delay = failureClass === 'BACKEND_UNAVAILABLE' ? 0 : backoffMs(attempt);
        await this.tasks.enqueue(task, attempt + 1, delay);
        log.warn('task requeued', { state: nextState, attempt, delayMs: delay });
      }
    }
  }

  /**
   * 다음 게시 슬롯까지의 지연. 채널 최소 간격을 기준으로 잡는다.
   * 격리된 채널은 사람이 풀어야 하므로 길게 둔다.
   */
  private async nextSlotDelayMs(task: Task): Promise<number> {
    const channelId = task.payload.channelId as string | undefined;
    if (!channelId) return 60 * 60_000;
    const ch = await this.ds.getRepository(Channel).findOne({ where: { id: channelId } });
    if (!ch) return 60 * 60_000;
    if (ch.healthState === 'QUARANTINE') return 6 * 60 * 60_000; // 6시간 뒤 재확인
    return Math.max(ch.minIntervalMin, config.channel.minIntervalMin, 5) * 60_000;
  }

  /** Task 가 최종 실패하면 대상 콘텐츠·Scene 도 실패로 내려 오더 마감 판정이 걸리게 한다. */
  private async markContentFailed(task: Task): Promise<void> {
    // 게시 단계 실패는 콘텐츠 문제가 아니다. 산출물은 멀쩡하고 다시 올리면 된다.
    // 상태를 내리면 승인된 콘텐츠가 재게시 불가능해지므로 건드리지 않는다.
    if (task.kind === 'PUBLISH') return;

    if (task.sceneId) {
      await this.ds.getRepository(Scene).update(task.sceneId, { status: 'FAILED' });
    }
    if (task.contentId) {
      const content = await this.ds.getRepository(Content).findOne({ where: { id: task.contentId } });
      if (content && !['PUBLISHED', 'BLOCKED', 'REJECTED'].includes(content.status)) {
        await this.ds.getRepository(Content).update(task.contentId, { status: 'FAILED' });
      }
    }
    if (task.orderId) {
      const order = await this.ds.getRepository(Order).findOne({ where: { id: task.orderId } });
      // SELECTION/BLUEPRINT 단계 실패는 콘텐츠가 아직 없으므로 오더를 직접 마감한다.
      if (order && ['SELECTION', 'BLUEPRINT'].includes(task.kind) && order.status === 'RUNNING') {
        await this.ds.getRepository(Order).update(task.orderId, { status: 'PARTIAL' });
      }
    }
  }
}
