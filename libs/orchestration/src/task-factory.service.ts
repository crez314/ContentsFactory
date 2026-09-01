import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { Task, TaskEvent, canTransitionTask, type TaskKind, type TaskState } from '@cf/domain';
import { AppError, config, createLogger, idempotencyKey } from '@cf/common';
import { JobEnvelope, QUEUE_SPECS, getRedis, type QueueName } from '@cf/queue';

export interface CreateTaskInput {
  kind: TaskKind;
  orderId?: string | null;
  contentId?: string | null;
  sceneId?: string | null;
  agentId?: string | null;
  priority?: number;
  attempt?: number;
  maxRetry?: number;
  budgetCapKrw?: number;
  payload?: Record<string, unknown>;
}

/**
 * Task 생성과 큐 투입을 한 곳에 모은다.
 * API·오케스트레이터·워커가 모두 이 서비스를 통해서만 Task 를 만든다.
 * 멱등키가 이미 있으면 새로 만들지 않고 기존 Task 를 돌려준다 (§3.5).
 */
@Injectable()
export class TaskFactory implements OnModuleDestroy {
  private readonly log = createLogger('task-factory');
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly ds: DataSource) {}

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: getRedis(), prefix: config.redis.queuePrefix });
      this.queues.set(name, q);
    }
    return q;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const spec = QUEUE_SPECS[input.kind];
    const attempt = input.attempt ?? 1;
    const key = idempotencyKey({
      kind: input.kind,
      orderId: input.orderId,
      contentId: input.contentId,
      sceneId: input.sceneId,
      attempt,
    });

    const repo = this.ds.getRepository(Task);
    const existing = await repo.findOne({ where: { idempotencyKey: key } });
    if (existing) {
      // 이미 끝난 Task 는 그대로 둔다.
      if (existing.state === 'DONE') {
        this.log.info('task already done, reusing', { taskId: existing.id, kind: input.kind });
        return existing;
      }
      // 아직 살아 있는 Task 는 중복 투입하지 않는다.
      if (['QUEUED', 'RUNNING', 'RETRY', 'FALLBACK'].includes(existing.state)) {
        this.log.info('task already in flight, reusing', { taskId: existing.id, kind: input.kind, state: existing.state });
        return existing;
      }
      // FAILED/ESCALATED/CANCELLED 는 되살린다.
      // 여기서 그냥 반환해버리면 후속 단계가 영원히 큐에 들어가지 않아 오더가 멈춘다.
      const from = existing.state;
      existing.state = 'QUEUED';
      existing.startedAt = null;
      existing.finishedAt = null;
      existing.error = null;
      existing.slaDeadline = new Date(Date.now() + spec.slaMs);
      await repo.save(existing);
      await this.recordEvent(existing.id, from, 'QUEUED', 'revived_by_orchestrator');
      await this.enqueue(existing, existing.retryCount + 1);
      this.log.info('dead task revived and requeued', {
        taskId: existing.id, kind: input.kind, from, retryCount: existing.retryCount,
      });
      return existing;
    }

    const task = repo.create({
      kind: input.kind,
      orderId: input.orderId ?? null,
      contentId: input.contentId ?? null,
      sceneId: input.sceneId ?? null,
      agentId: input.agentId ?? null,
      priority: input.priority ?? 3,
      state: 'QUEUED',
      retryCount: attempt - 1,
      maxRetry: input.maxRetry ?? spec.maxRetry,
      idempotencyKey: key,
      payload: { ...input.payload, attempt, budgetCapKrw: input.budgetCapKrw ?? 0 },
      slaDeadline: new Date(Date.now() + spec.slaMs),
    });
    await repo.save(task);
    await this.recordEvent(task.id, null, 'QUEUED', 'created');
    await this.enqueue(task, attempt);

    this.log.info('task created', {
      taskId: task.id, kind: task.kind,
      orderId: task.orderId ?? undefined, contentId: task.contentId ?? undefined,
    });
    return task;
  }

  /** 큐 투입. 워커는 봉투(JobEnvelope)만 신뢰한다 (§3.2). */
  async enqueue(task: Task, attempt: number, delayMs = 0): Promise<void> {
    const spec = QUEUE_SPECS[task.kind];
    const envelope: JobEnvelope = {
      taskId: task.id,
      kind: task.kind,
      orderId: task.orderId ?? undefined,
      contentId: task.contentId ?? undefined,
      sceneId: task.sceneId ?? undefined,
      agentId: task.agentId ?? undefined,
      attempt,
      idempotencyKey: task.idempotencyKey,
      budgetCapKrw: Number(task.payload.budgetCapKrw ?? 0),
      deadline: (task.slaDeadline ?? new Date(Date.now() + spec.slaMs)).toISOString(),
      payload: task.payload,
    };
    JobEnvelope.parse(envelope); // 투입 전 계약 검증

    await this.queue(spec.name).add(task.kind, envelope, {
      /**
       * BullMQ jobId 는 ':' 를 허용하지 않으므로 멱등키의 구분자를 치환한다.
       *
       * 뒤에 nonce 를 붙이는 이유 — BullMQ 는 같은 jobId 의 add 를 조용히 무시한다.
       * 죽은 Task 를 되살릴 때(retryCount 가 그대로면) 같은 jobId 가 만들어져
       * 큐 투입이 사라지고 Task 가 QUEUED 인 채 영원히 멈춘다.
       * 중복 실행 방지는 §3.5 의 조건부 UPDATE(claim)가 담당하므로,
       * 여기서는 매 투입을 별개 Job 으로 두는 편이 안전하다.
       */
      jobId: `${task.idempotencyKey.replace(/:/g, '~')}#${attempt}#${Date.now().toString(36)}`,
      priority: task.priority, // 0~4, 낮을수록 먼저
      delay: delayMs,
      removeOnComplete: 500,
      removeOnFail: 1000,
      attempts: 1, // 재시도는 오케스트레이터가 관리한다. BullMQ 자체 재시도는 쓰지 않는다.
    });
  }

  async recordEvent(
    taskId: string,
    from: TaskState | null,
    to: TaskState,
    reason?: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const repo = this.ds.getRepository(TaskEvent);
    await repo.save(repo.create({ taskId, fromState: from, toState: to, reason: reason ?? null, meta: meta ?? null }));
  }

  /** 상태 전이는 반드시 이 메서드를 거친다. 잘못된 전이는 여기서 막힌다. */
  async transition(
    taskId: string,
    to: TaskState,
    opts: { reason?: string; meta?: Record<string, unknown>; result?: unknown; error?: unknown } = {},
  ): Promise<Task> {
    const repo = this.ds.getRepository(Task);
    const task = await repo.findOne({ where: { id: taskId } });
    if (!task) throw new AppError('TASK_NOT_FOUND');
    if (!canTransitionTask(task.state, to)) {
      throw new AppError('TASK_INVALID_STATE', { details: [{ from: task.state, to }] });
    }

    const from = task.state;
    task.state = to;
    if (to === 'RUNNING' && !task.startedAt) task.startedAt = new Date();
    if (['DONE', 'FAILED', 'CANCELLED'].includes(to)) task.finishedAt = new Date();
    if (opts.result !== undefined) task.result = opts.result;
    if (opts.error !== undefined) task.error = opts.error;
    await repo.save(task);
    await this.recordEvent(taskId, from, to, opts.reason, opts.meta);
    return task;
  }
}
