import { Client } from '../e2e/client';

/**
 * §9.1 / §12 부하 — 동시 오더 10건.
 * k6 없이 돌릴 수 있도록 Node 로 작성했다. 조회 API 의 p95 도 함께 측정한다.
 *
 *   pnpm test:load                 # 기본 10건
 *   ORDERS=20 pnpm test:load
 */

const ORDERS = Number(process.env.ORDERS ?? 10);
const PASSWORD = 'crez1234!';

interface Timing { label: string; ms: number }
const timings: Timing[] = [];

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ label, ms: Date.now() - t0 });
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(label: string, targetMs: number): void {
  const ms = timings.filter((t) => t.label === label).map((t) => t.ms);
  if (!ms.length) return;
  const p95 = percentile(ms, 95);
  const ok = p95 <= targetMs;
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(
    `  ${mark} ${label.padEnd(22)} n=${String(ms.length).padStart(3)}  ` +
    `p50=${percentile(ms, 50)}ms  p95=${p95}ms  max=${Math.max(...ms)}ms  (목표 p95 ${targetMs}ms)`,
  );
}

async function main(): Promise<void> {
  const client = new Client();
  await client.login('operator@crez.local', PASSWORD);

  const artists = await client.get<Array<{ id: string; status: string }>>('/artists');
  const channels = await client.get<Array<{ id: string; platform: string }>>('/channels');
  const agents = await client.get<Array<{ id: string; kind: string; approvalLevel: number }>>('/agents');
  const artist = artists.find((a) => a.status === 'ACTIVE')!;
  const youtube = channels.find((c) => c.platform === 'YOUTUBE')!;
  const agent = agents.find((a) => a.kind === 'VIDEO' && a.approvalLevel >= 2)!;

  console.log(`\n\x1b[1m동시 오더 ${ORDERS}건 제출\x1b[0m`);
  const t0 = Date.now();

  const orderIds = await Promise.all(
    Array.from({ length: ORDERS }, async (_, i) => {
      const order = await timed('POST /orders', () =>
        client.post<{ id: string }>('/orders', {
          artistId: artist.id, channelIds: [youtube.id], agentId: agent.id,
          outputType: 'IMAGE', quantity: 1,
          concept: { campaign: 'LOAD', mood: 'bright', story: `load_${i}` },
          design: { tone: 'warm', palette: ['#F2E7D5'], template: 'crez_basic_v1' },
          spec: { aspect: '9:16', resolution: '1080x1920' },
          assetFilter: { include: { outfit: ['casual'] } },
          budgetCapKrw: 300_000, approvalLevel: 3,
        }, { 'Idempotency-Key': `load-${Date.now()}-${i}` }),
      );
      await timed('POST /orders/submit', () => client.post(`/orders/${order.id}/submit`));
      return order.id;
    }),
  );
  console.log(`  제출 완료 — ${Date.now() - t0}ms`);

  console.log(`\n\x1b[1m처리 대기 (조회 API 응답시간 동시 측정)\x1b[0m`);
  const deadline = Date.now() + 15 * 60_000;
  let done = 0;

  for (;;) {
    const statuses = await Promise.all(
      orderIds.map((id) => timed('GET /orders/{id}', () => client.get<{ status: string }>(`/orders/${id}`))),
    );
    await timed('GET /dashboard', () => client.get('/dashboard/summary'));
    await timed('GET /contents', () => client.get('/contents?limit=20'));
    await timed('GET /tasks', () => client.get('/tasks?limit=20'));

    done = statuses.filter((s) => ['DONE', 'PARTIAL', 'CANCELLED', 'REJECTED'].includes(s.status)).length;
    process.stdout.write(`\r  마감 ${done}/${ORDERS} — ${Math.round((Date.now() - t0) / 1000)}초 경과   `);
    if (done === ORDERS) break;
    if (Date.now() > deadline) {
      console.log('\n  \x1b[33m타임아웃 — 일부 오더가 마감되지 않았습니다.\x1b[0m');
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n\n\x1b[1m결과\x1b[0m`);
  console.log(`  오더 ${ORDERS}건, 마감 ${done}건, 총 ${totalSec}초 (건당 평균 ${(totalSec / ORDERS).toFixed(1)}초)`);

  console.log(`\n\x1b[1m응답시간 (§9.1 목표)\x1b[0m`);
  report('GET /orders/{id}', 300);
  report('GET /dashboard', 300);
  report('GET /contents', 300);
  report('GET /tasks', 300);
  report('POST /orders', 1000);
  report('POST /orders/submit', 3000); // §9.1 오더 검증 p95 3초

  const costs = await client.get<{ byProvider: Array<{ provider: string; cost: number; calls: number }> }>(
    '/dashboard/costs?days=1',
  );
  console.log(`\n\x1b[1m비용\x1b[0m`);
  for (const p of costs.byProvider) {
    console.log(`  ${p.provider.padEnd(18)} ${p.calls}회  ${p.cost.toLocaleString()}원`);
  }

  process.exit(done === ORDERS ? 0 : 1);
}

void main().catch((err) => {
  console.error('\n부하 테스트 실패');
  console.error(err);
  process.exit(1);
});
