import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Agent, Artist, Blueprint, Channel, Content, Order, Selection, Task,
  canTransitionOrder, contentStage, estimateCost, ORDER_STAGES,
  type AssetFilter, type OrderConcept, type OrderDesign, type OrderSpec, type OutputType,
} from '@cf/domain';
import { AppError, createLogger, type AuthUser } from '@cf/common';
import { encodeCursor, parsePaging } from '../common/pagination';
import { OrderValidatorService } from './order-validator.service';
import { TaskFactory } from '@cf/orchestration';
import { MODEL_PRICING } from './pricing';

export interface CreateOrderInput {
  artistId: string;
  channelIds: string[];
  agentId?: string;
  outputType: OutputType;
  quantity: number;
  concept: OrderConcept;
  design: OrderDesign;
  spec: OrderSpec;
  assetFilter: AssetFilter;
  budgetCapKrw: number;
  approvalLevel: number;
  scheduledAt?: string | null;
}

@Injectable()
export class OrderService {
  private readonly log = createLogger('order');

  constructor(
    private readonly ds: DataSource,
    private readonly validator: OrderValidatorService,
    private readonly tasks: TaskFactory,
  ) {}

  /**
   * ORD-YYYYMMDD-NNNN. 같은 날짜 안에서 순번을 매긴다.
   *
   * COUNT 후 +1 방식은 동시 제출 시 같은 번호를 만들어 유니크 제약에 걸린다.
   * 날짜별 카운터를 UPSERT ... RETURNING 으로 올려 한 번의 원자적 연산으로 끝낸다.
   */
  private async nextOrderNo(): Promise<string> {
    const rows = await this.ds.query<Array<{ day: string; seq: number }>>(
      `INSERT INTO order_no_counters (day, seq) VALUES (current_date, 1)
         ON CONFLICT (day) DO UPDATE SET seq = order_no_counters.seq + 1, updated_at = now()
       RETURNING to_char(day, 'YYYYMMDD') AS day, seq`,
    );
    const { day, seq } = rows[0];
    return `ORD-${day}-${String(seq).padStart(4, '0')}`;
  }

  async create(input: CreateOrderInput, user: AuthUser, idempotencyKey?: string) {
    const repo = this.ds.getRepository(Order);

    // §5.1 생성 요청은 Idempotency-Key 를 지원한다.
    if (idempotencyKey) {
      const existing = await repo.findOne({
        where: { idempotencyKey },
        relations: { channels: true },
      });
      if (existing) return existing;
    }

    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: input.artistId } });
    if (!artist) throw new AppError('NOT_FOUND', { message: '아티스트를 찾을 수 없습니다.' });

    const channels = await this.ds.getRepository(Channel).findByIds(input.channelIds);
    if (channels.length !== input.channelIds.length) {
      throw new AppError('NOT_FOUND', { message: '존재하지 않는 채널이 포함되어 있습니다.' });
    }
    if (input.agentId) {
      const agent = await this.ds.getRepository(Agent).findOne({ where: { id: input.agentId } });
      if (!agent) throw new AppError('NOT_FOUND', { message: '에이전트를 찾을 수 없습니다.' });
    }

    const order = repo.create({
      orderNo: await this.nextOrderNo(),
      artistId: input.artistId,
      requestedBy: user.id,
      agentId: input.agentId ?? null,
      outputType: input.outputType,
      quantity: input.quantity,
      concept: input.concept,
      design: input.design,
      spec: input.spec,
      assetFilter: input.assetFilter,
      budgetCap: input.budgetCapKrw,
      approvalLevel: input.approvalLevel,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: 'DRAFT',
      idempotencyKey: idempotencyKey ?? null,
      channels,
    });
    await repo.save(order);
    this.log.info('order created', { orderId: order.id, orderNo: order.orderNo });
    return order;
  }

  async update(id: string, patch: Partial<CreateOrderInput>) {
    const repo = this.ds.getRepository(Order);
    const order = await repo.findOne({ where: { id }, relations: { channels: true } });
    if (!order) throw new AppError('ORDER_NOT_FOUND');
    // 수정은 DRAFT 와 REJECTED 에서만 허용한다.
    if (!['DRAFT', 'REJECTED'].includes(order.status)) {
      throw new AppError('ORDER_INVALID_STATE', { details: [{ status: order.status }] });
    }

    if (patch.channelIds) {
      order.channels = await this.ds.getRepository(Channel).findByIds(patch.channelIds);
    }
    for (const key of ['outputType', 'quantity', 'concept', 'design', 'spec', 'assetFilter', 'approvalLevel', 'agentId'] as const) {
      if (patch[key] !== undefined) (order as unknown as Record<string, unknown>)[key] = patch[key];
    }
    if (patch.budgetCapKrw !== undefined) order.budgetCap = patch.budgetCapKrw;
    if (patch.scheduledAt !== undefined) order.scheduledAt = patch.scheduledAt ? new Date(patch.scheduledAt) : null;
    if (order.status === 'REJECTED') {
      order.status = 'DRAFT';
      order.rejectReason = null;
    }
    return repo.save(order);
  }

  /** 제출 없이 검증만 수행한다. 상태는 바꾸지 않는다. */
  validate(id: string) {
    return this.validator.validate(id);
  }

  /**
   * 제출 → 검증 → 큐 투입.
   * 검증 실패 시 REJECTED 로 두고 사유를 남긴다. 통과하면 SELECTION Task 를 만들고 QUEUED 로 올린다.
   */
  async submit(id: string) {
    const repo = this.ds.getRepository(Order);
    const order = await repo.findOne({ where: { id }, relations: { channels: true } });
    if (!order) throw new AppError('ORDER_NOT_FOUND');
    if (!canTransitionOrder(order.status, 'VALIDATING')) {
      throw new AppError('ORDER_INVALID_STATE', { details: [{ from: order.status, to: 'VALIDATING' }] });
    }

    await repo.update(id, { status: 'VALIDATING' });
    const result = await this.validator.validate(id);

    if (!result.ok) {
      await repo.update(id, { status: 'REJECTED', rejectReason: result.errors });
      this.log.warn('order rejected by validator', { orderId: id, errors: result.errors });
      return { order: await repo.findOne({ where: { id } }), validation: result };
    }

    // Task 를 먼저 만들고 나서 QUEUED 로 올린다.
    // 큐 투입이 실패했는데 상태만 QUEUED 로 남으면 오더가 영원히 멈춘 채로 보이기 때문이다.
    try {
      await this.tasks.createTask({
        kind: 'SELECTION',
        orderId: id,
        agentId: order.agentId,
        priority: order.approvalLevel >= 2 ? 3 : 2,
        budgetCapKrw: order.budgetCap,
        payload: { orderId: id },
      });
    } catch (err) {
      await repo.update(id, { status: 'DRAFT' });
      this.log.error('failed to enqueue selection task; order returned to DRAFT', { orderId: id, err });
      throw err;
    }
    await repo.save({ id, status: 'QUEUED' as const, rejectReason: null });
    this.log.info('order submitted', { orderId: id, estimatedCostKrw: result.estimatedCostKrw });
    return { order: await repo.findOne({ where: { id } }), validation: result };
  }

  async cancel(id: string, reason?: string) {
    const repo = this.ds.getRepository(Order);
    const order = await repo.findOne({ where: { id } });
    if (!order) throw new AppError('ORDER_NOT_FOUND');
    if (!canTransitionOrder(order.status, 'CANCELLED')) {
      throw new AppError('ORDER_INVALID_STATE', { details: [{ from: order.status, to: 'CANCELLED' }] });
    }

    await repo.save({
      id,
      status: 'CANCELLED' as const,
      rejectReason: reason ? [{ code: 'CANCELLED', detail: { reason } }] : null,
    });
    // 진행 중인 Task 는 함께 취소한다.
    await this.ds
      .getRepository(Task)
      .createQueryBuilder()
      .update()
      .set({ state: 'CANCELLED', finishedAt: () => 'now()' })
      .where('order_id = :id', { id })
      .andWhere("state IN ('QUEUED','RETRY','FALLBACK')")
      .execute();
    return repo.findOne({ where: { id } });
  }

  async list(q: { status?: string; artistId?: string; limit?: string; cursor?: string }) {
    const { limit, cursor } = parsePaging(q);
    const qb = this.ds
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.artist', 'artist')
      .leftJoinAndSelect('o.channels', 'channels')
      .leftJoinAndSelect('o.requester', 'requester');

    if (q.status) qb.andWhere('o.status = :status', { status: q.status });
    if (q.artistId) qb.andWhere('o.artist_id = :artistId', { artistId: q.artistId });
    if (cursor) qb.andWhere('(o.created_at, o.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });

    const rows = await qb.orderBy('o.createdAt', 'DESC').addOrderBy('o.id', 'DESC').take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const withProgress = await Promise.all(page.map(async (o) => ({ ...o, progress: await this.progress(o.id) })));
    return { items: withProgress, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
  }

  /** §7.2 오더별 진행률 바 — 선별→생성→QC→승인→게시 5단계 */
  async progress(orderId: string) {
    const contents = await this.ds.getRepository(Content).find({ where: { orderId } });
    const counts = Object.fromEntries(ORDER_STAGES.map((s) => [s, 0])) as Record<string, number>;
    for (const c of contents) counts[contentStage(c.status)] += 1;

    const total = contents.length;
    const published = contents.filter((c) => c.status === 'PUBLISHED').length;
    const failed = contents.filter((c) => ['BLOCKED', 'FAILED', 'REJECTED'].includes(c.status)).length;
    return {
      total,
      published,
      failed,
      stages: counts,
      percent: total ? Math.round(((published + failed) / total) * 100) : 0,
    };
  }

  async findOne(id: string) {
    const order = await this.ds.getRepository(Order).findOne({
      where: { id },
      relations: { artist: true, channels: true, requester: true, agent: true },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND');

    const [selections, blueprints, contents, tasks] = await Promise.all([
      this.ds.getRepository(Selection).find({ where: { orderId: id }, relations: { asset: true }, order: { rank: 'ASC' } }),
      this.ds.getRepository(Blueprint).find({ where: { orderId: id }, order: { seq: 'ASC' } }),
      this.ds.getRepository(Content).find({ where: { orderId: id }, order: { createdAt: 'ASC' } }),
      this.ds.getRepository(Task).find({ where: { orderId: id }, order: { queuedAt: 'DESC' }, take: 50 }),
    ]);

    const estimate = estimateCost(
      {
        outputType: order.outputType,
        quantity: order.quantity,
        channelCount: order.channels?.length ?? 1,
        spec: order.spec,
      },
      MODEL_PRICING,
    );

    return {
      ...order,
      selections,
      blueprints,
      contents,
      tasks,
      estimate,
      progress: await this.progress(id),
    };
  }
}
