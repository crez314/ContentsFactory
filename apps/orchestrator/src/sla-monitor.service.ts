import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, In, LessThan } from 'typeorm';
import { Task } from '@cf/domain';
import { config, createLogger } from '@cf/common';
import { acquireLock } from '@cf/queue';
import { NotifierService } from '@cf/model-abstraction';
import { TaskFactory } from '@cf/orchestration';

/**
 * §3.4 SLA 감시.
 * 1분 주기로 sla_deadline 이 지난 QUEUED/RUNNING Task 를 스캔해 에스컬레이션한다.
 * 분산 락으로 감싸 인스턴스가 여럿이어도 한 번만 돈다 (§3.5).
 */
@Injectable()
export class SlaMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = createLogger('sla-monitor');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly ds: DataSource,
    private readonly tasks: TaskFactory,
    private readonly notifier: NotifierService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.scan(), config.ops.slaScanIntervalMs);
    this.timer.unref();
    this.log.info('sla monitor started', { intervalMs: config.ops.slaScanIntervalMs });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<number> {
    const release = await acquireLock('orchestrator:sla-scan', config.ops.slaScanIntervalMs);
    if (!release) return 0;

    try {
      const overdue = await this.ds.getRepository(Task).find({
        where: { state: In(['QUEUED', 'RUNNING']), slaDeadline: LessThan(new Date()) },
        take: 100,
      });

      for (const task of overdue) {
        await this.tasks.transition(task.id, 'ESCALATED', {
          reason: 'sla_breach',
          meta: { slaDeadline: task.slaDeadline?.toISOString(), state: task.state },
        }).catch((err) => this.log.warn('sla escalation failed', { taskId: task.id, err }));

        await this.notifier.escalate('sla_breach', {
          taskId: task.id, kind: task.kind, state: task.state,
          slaDeadline: task.slaDeadline?.toISOString(),
        });
      }
      if (overdue.length) this.log.warn('sla breaches escalated', { count: overdue.length });
      return overdue.length;
    } finally {
      await release();
    }
  }
}
