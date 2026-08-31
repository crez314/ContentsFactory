import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import {
  Agent, Asset, AssetLicense, Content, CostLog, Order, Publication, QcResult, Task,
} from '@cf/domain';
import { config } from '@cf/common';
import { ALL_WORK_QUEUES, getRedis } from '@cf/queue';
import { ModelRegistry, NotifierService } from '@cf/model-abstraction';

/** §7.2 대시보드 */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly ds: DataSource,
    private readonly registry: ModelRegistry,
    private readonly notifier: NotifierService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '대시보드 KPI + 진행 중 오더 + 주의 필요 + 시스템 상태' })
  async summary() {
    const [kpi, runningOrders, attention, system] = await Promise.all([
      this.kpi(),
      this.runningOrders(),
      this.attention(),
      this.system(),
    ]);
    return { kpi, runningOrders, attention, system };
  }

  private async kpi() {
    const rows = await this.ds.query<Array<Record<string, string>>>(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE created_at >= date_trunc('day', now()))                         AS orders_today,
        (SELECT COUNT(*) FROM contents WHERE status IN ('PENDING','GENERATING','RENDERING','QC'))          AS generating,
        (SELECT COUNT(*) FROM contents WHERE status = 'READY')                                             AS awaiting_approval,
        (SELECT COUNT(*) FROM contents WHERE status = 'PUBLISHED')                                         AS published,
        (SELECT COUNT(*) FROM contents WHERE status IN ('FAILED','BLOCKED','QC_FAILED'))                   AS failed,
        (SELECT COALESCE(SUM(cost_krw),0) FROM cost_logs WHERE occurred_at >= date_trunc('day', now()))    AS cost_today,
        (SELECT COALESCE(SUM(cost_krw),0) FROM cost_logs WHERE occurred_at >= date_trunc('month', now()))  AS cost_month,
        (SELECT COUNT(*) FROM tasks WHERE state = 'ESCALATED')                                             AS escalated
    `);
    const r = rows[0];
    return {
      ordersToday: Number(r.orders_today),
      generating: Number(r.generating),
      awaitingApproval: Number(r.awaiting_approval),
      published: Number(r.published),
      failed: Number(r.failed),
      costTodayKrw: Number(r.cost_today),
      costMonthKrw: Number(r.cost_month),
      escalated: Number(r.escalated),
    };
  }

  /** 오더별 5단계 진행률 */
  private async runningOrders() {
    const orders = await this.ds.getRepository(Order).find({
      where: [{ status: 'RUNNING' }, { status: 'QUEUED' }, { status: 'PARTIAL' }],
      relations: { artist: true },
      order: { createdAt: 'DESC' },
      take: 12,
    });
    if (!orders.length) return [];

    const rows = await this.ds.query<Array<{ order_id: string; status: string; count: string }>>(
      `SELECT order_id, status, COUNT(*)::text AS count FROM contents WHERE order_id = ANY($1) GROUP BY 1,2`,
      [orders.map((o) => o.id)],
    );
    const byOrder = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = byOrder.get(r.order_id) ?? {};
      m[r.status] = Number(r.count);
      byOrder.set(r.order_id, m);
    }

    return orders.map((o) => {
      const counts = byOrder.get(o.id) ?? {};
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      const done = (counts.PUBLISHED ?? 0) + (counts.BLOCKED ?? 0) + (counts.FAILED ?? 0) + (counts.REJECTED ?? 0);
      return {
        id: o.id,
        orderNo: o.orderNo,
        artistName: o.artist?.name ?? null,
        status: o.status,
        outputType: o.outputType,
        counts,
        total,
        percent: total ? Math.round((done / total) * 100) : 0,
      };
    });
  }

  /** 에스컬레이션 Task, 예산 초과 에이전트, 라이선스 만료 임박 자산 */
  private async attention() {
    const [escalatedTasks, budgetAgents, expiring] = await Promise.all([
      this.ds.getRepository(Task).find({ where: { state: 'ESCALATED' }, order: { updatedAt: 'DESC' }, take: 20 }),
      this.ds.getRepository(Agent).find({ where: { lifecycle: 'PAUSED_BUDGET' } }),
      this.ds.query<Array<{ asset_id: string; valid_until: string }>>(
        // date 컬럼을 그대로 넘기면 드라이버가 Date 로 바꿔 타임존이 섞인다. 문자열로 고정한다.
        `SELECT asset_id, valid_until::text AS valid_until FROM asset_licenses
          WHERE valid_until BETWEEN now()::date AND (now() + interval '30 days')::date
          ORDER BY valid_until ASC LIMIT 20`,
      ),
    ]);
    return {
      escalatedTasks,
      budgetPausedAgents: budgetAgents,
      expiringLicenses: expiring.map((e) => ({ assetId: e.asset_id, validUntil: e.valid_until })),
      alerts: this.notifier.recent(20),
    };
  }

  /** API·워커·큐 길이·외부 어댑터 health */
  private async system() {
    const redis = getRedis();
    const queues = await Promise.all(
      ALL_WORK_QUEUES.map(async (name) => {
        const q = new Queue(name, { connection: redis, prefix: config.redis.queuePrefix });
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        await q.close();
        return { name, ...counts };
      }),
    );
    const [{ heartbeat }] = [{ heartbeat: await redis.hgetall('cf:heartbeat') }];
    return {
      queues,
      adapters: await this.registry.healthReport(),
      services: heartbeat,
      env: config.env,
      storageDriver: config.storage.driver,
    };
  }

  /** §7.1 운영 → 비용 화면 */
  @Get('costs')
  @ApiOperation({ summary: '비용 집계 (일자별 · 어댑터별 · 에이전트별)' })
  async costs(@Query('days') days = '14') {
    const n = Math.min(90, Math.max(1, Number(days) || 14));
    const [byDay, byProvider, byAgent] = await Promise.all([
      this.ds.query(
        `SELECT date_trunc('day', occurred_at)::date AS day, SUM(cost_krw)::float AS cost, COUNT(*)::int AS calls
           FROM cost_logs WHERE occurred_at >= now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1`, [n]),
      this.ds.query(
        `SELECT provider, SUM(cost_krw)::float AS cost, COUNT(*)::int AS calls
           FROM cost_logs WHERE occurred_at >= now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 2 DESC`, [n]),
      this.ds.query(
        `SELECT a.id AS agent_id, a.name, SUM(c.cost_krw)::float AS cost, a.daily_budget::float AS daily_budget
           FROM cost_logs c JOIN agents a ON a.id = c.agent_id
          WHERE c.occurred_at >= now() - ($1 || ' days')::interval
          GROUP BY 1,2,4 ORDER BY 3 DESC`, [n]),
    ]);

    const perContent = await this.ds.query<Array<{ avg: string | null }>>(
      `SELECT AVG(t.cost)::text AS avg FROM (
         SELECT content_id, SUM(cost_krw) AS cost FROM cost_logs
          WHERE content_id IS NOT NULL AND occurred_at >= now() - ($1 || ' days')::interval
          GROUP BY 1) t`, [n]);

    return { days: n, byDay, byProvider, byAgent, avgCostPerContentKrw: Number(perContent[0]?.avg ?? 0) };
  }

  /** §7.1 운영 → 실패·에스컬레이션 */
  @Get('escalations')
  async escalations() {
    const tasks = await this.ds.getRepository(Task).find({
      where: [{ state: 'ESCALATED' }, { state: 'FAILED' }],
      order: { updatedAt: 'DESC' },
      take: 100,
    });
    const blocked = await this.ds.getRepository(Content).find({
      where: [{ status: 'BLOCKED' }, { status: 'QC_FAILED' }],
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    const blockedQc = blocked.length
      ? await this.ds.getRepository(QcResult).find({ where: blocked.map((c) => ({ contentId: c.id })) })
      : [];
    return { tasks, blockedContents: blocked, qcResults: blockedQc };
  }
}
