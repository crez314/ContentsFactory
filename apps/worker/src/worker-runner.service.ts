import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job, Queue, Worker } from 'bullmq';
import { Task, TASK_KIND, type TaskKind } from '@cf/domain';
import { classify, config, createLogger, serializeError } from '@cf/common';
import { JobEnvelope, QUEUE, QUEUE_SPECS, getRedis, newRedis } from '@cf/queue';
import { ProcessorRegistry } from './processors/processor.registry';

/**
 * 큐 소비 루프.
 * §3.5 멱등성 — 실행 전 tasks.state 를 조건부 UPDATE 하고, 갱신 행이 0이면
 * 이미 처리된 것으로 보고 조용히 종료한다.
 */
@Injectable()
export class WorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly log = createLogger('worker');
  private readonly workers: Worker[] = [];
  private orchestrateQueue?: Queue;

  constructor(
    private readonly ds: DataSource,
    private readonly processors: ProcessorRegistry,
  ) {}

  onModuleInit(): void {
    this.orchestrateQueue = new Queue(QUEUE.ORCHESTRATE, {
      connection: getRedis(),
      prefix: config.redis.queuePrefix,
    });

    for (const kind of TASK_KIND) {
      const spec = QUEUE_SPECS[kind];
      const worker = new Worker(
        spec.name,
        (job) => this.run(job),
        { connection: newRedis(), prefix: config.redis.queuePrefix, concurrency: spec.concurrency },
      );
      worker.on('error', (err) => this.log.error('worker error', { queue: spec.name, err }));
      this.workers.push(worker);
      this.log.info('queue worker started', { queue: spec.name, concurrency: spec.concurrency });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await this.orchestrateQueue?.close().catch(() => undefined);
  }

  /** §3.5 조건부 UPDATE 로 실행권을 잡는다. */
  private async claim(taskId: string): Promise<boolean> {
    const rows = await this.ds.query<Array<{ id: string }>>(
      `UPDATE tasks
          SET state = 'RUNNING', started_at = now(), updated_at = now()
        WHERE id = $1 AND state IN ('QUEUED','RETRY','FALLBACK')
      RETURNING id`,
      [taskId],
    );
    return rows.length > 0;
  }

  private async run(job: Job): Promise<void> {
    const envelope = JobEnvelope.parse(job.data);
    const log = this.log.child({
      taskId: envelope.taskId, kind: envelope.kind,
      orderId: envelope.orderId, contentId: envelope.contentId, sceneId: envelope.sceneId,
    });

    if (!(await this.claim(envelope.taskId))) {
      log.info('task already claimed, skipping');
      return;
    }

    await this.ds.query(
      `INSERT INTO task_events(task_id, from_state, to_state, reason) VALUES ($1, $2, 'RUNNING', 'claimed')`,
      [envelope.taskId, 'QUEUED'],
    );

    const started = Date.now();
    try {
      const result = await this.processors.get(envelope.kind as TaskKind).process(envelope);
      await this.ds.getRepository(Task).save({
        id: envelope.taskId,
        state: 'DONE' as const,
        result: result ?? null,
        finishedAt: new Date(),
        error: null,
      });
      await this.ds.query(
        `INSERT INTO task_events(task_id, from_state, to_state, reason) VALUES ($1, 'RUNNING', 'DONE', 'completed')`,
        [envelope.taskId],
      );
      await this.notifyOrchestrator({ taskId: envelope.taskId, outcome: 'DONE' });
      log.info('task completed', { durationMs: Date.now() - started });
    } catch (err) {
      const failureClass = classify(err);
      const serialized = serializeError(err);
      await this.ds.getRepository(Task).save({ id: envelope.taskId, error: serialized });
      log.error('task failed', { durationMs: Date.now() - started, failureClass, err });
      // 재시도·Fallback·에스컬레이션 판단은 오케스트레이터가 한다.
      await this.notifyOrchestrator({
        taskId: envelope.taskId, outcome: 'FAILED', failureClass, error: serialized,
      });
    }
  }

  private async notifyOrchestrator(msg: Record<string, unknown>): Promise<void> {
    await this.orchestrateQueue!.add('task-outcome', msg, {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }
}
