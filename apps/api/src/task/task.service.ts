import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Task, TaskEvent } from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { encodeCursor, parsePaging } from '../common/pagination';
import { TaskFactory } from '@cf/orchestration';

@Injectable()
export class TaskService {
  private readonly log = createLogger('task');

  constructor(private readonly ds: DataSource, private readonly factory: TaskFactory) {}

  async list(q: { state?: string; kind?: string; orderId?: string; contentId?: string; limit?: string; cursor?: string }) {
    const { limit, cursor } = parsePaging(q);
    const qb = this.ds.getRepository(Task).createQueryBuilder('t');
    if (q.state) qb.andWhere('t.state = ANY(:states)', { states: q.state.split(',') });
    if (q.kind) qb.andWhere('t.kind = ANY(:kinds)', { kinds: q.kind.split(',') });
    if (q.orderId) qb.andWhere('t.order_id = :orderId', { orderId: q.orderId });
    if (q.contentId) qb.andWhere('t.content_id = :contentId', { contentId: q.contentId });
    if (cursor) qb.andWhere('(t.queued_at, t.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });

    const rows = await qb.orderBy('t.queuedAt', 'DESC').addOrderBy('t.id', 'DESC').take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((t) => ({ ...t, elapsedMs: elapsed(t) })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.queuedAt, id: last.id }) : null,
    };
  }

  async findOne(id: string) {
    const task = await this.ds.getRepository(Task).findOne({ where: { id } });
    if (!task) throw new AppError('TASK_NOT_FOUND');
    const events = await this.ds.getRepository(TaskEvent).find({ where: { taskId: id }, order: { createdAt: 'ASC' } });
    return { ...task, elapsedMs: elapsed(task), events };
  }

  /** 운영자 수동 재시도 — 재시도 카운터를 올리고 같은 큐에 다시 넣는다. */
  async retry(id: string) {
    const repo = this.ds.getRepository(Task);
    const task = await repo.findOne({ where: { id } });
    if (!task) throw new AppError('TASK_NOT_FOUND');
    if (!['ESCALATED', 'FAILED', 'RETRY', 'FALLBACK'].includes(task.state)) {
      throw new AppError('TASK_INVALID_STATE', {
        details: [{ state: task.state, allowed: ['ESCALATED', 'FAILED', 'RETRY', 'FALLBACK'] }],
      });
    }

    task.retryCount += 1;
    task.error = null;
    task.finishedAt = null;
    await repo.save(task);
    await this.factory.transition(id, 'RUNNING', { reason: 'manual_retry' });
    // RUNNING 으로 올린 뒤 워커가 다시 claim 할 수 있도록 QUEUED 로 되돌린다.
    await repo.update(id, { state: 'QUEUED', startedAt: null });
    await this.factory.recordEvent(id, 'RUNNING', 'QUEUED', 'manual_retry_requeued');
    await this.factory.enqueue(task, task.retryCount + 1);
    this.log.info('task manually retried', { taskId: id, kind: task.kind, retryCount: task.retryCount });
    return this.findOne(id);
  }

  async cancel(id: string) {
    await this.factory.transition(id, 'CANCELLED', { reason: 'manual_cancel' });
    return this.findOne(id);
  }
}

function elapsed(t: Task): number {
  const start = t.startedAt ?? t.queuedAt;
  const end = t.finishedAt ?? new Date();
  return Math.max(0, end.getTime() - new Date(start).getTime());
}
