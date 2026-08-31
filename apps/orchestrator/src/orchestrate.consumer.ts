import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { z } from 'zod';
import { config, createLogger, type FailureClass } from '@cf/common';
import { QUEUE, getRedis, newRedis } from '@cf/queue';
import { OrchestratorService } from '@cf/orchestration';
import { FailureHandlerService } from './failure-handler.service';

const OrchestrateJob = z.object({
  taskId: z.string().uuid(),
  outcome: z.enum(['DONE', 'FAILED']),
  failureClass: z.string().optional(),
  error: z.unknown().optional(),
});

/**
 * 워커 → 오케스트레이터 통지 소비.
 * 워커가 다음 단계 큐에 직접 넣지 않기 위한 유일한 통로다 (§3.2 원칙).
 */
@Injectable()
export class OrchestrateConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly log = createLogger('orchestrate-consumer');
  private worker?: Worker;

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly failures: FailureHandlerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      QUEUE.ORCHESTRATE,
      async (job: Job) => {
        const msg = OrchestrateJob.parse(job.data);
        if (msg.outcome === 'DONE') {
          await this.orchestrator.onTaskDone(msg.taskId);
        } else {
          await this.failures.handle(msg.taskId, (msg.failureClass ?? 'TRANSIENT') as FailureClass, msg.error);
        }
      },
      {
        connection: newRedis(),
        prefix: config.redis.queuePrefix,
        // 순서 보장을 위해 단일 동시성. 오케스트레이터는 어차피 단일 인스턴스다.
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.log.error('orchestrate job failed', { jobId: job?.id, err });
    });
    this.log.info('orchestrate consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await getRedis().quit().catch(() => undefined);
  }
}
