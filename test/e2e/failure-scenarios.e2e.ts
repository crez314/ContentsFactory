import { Client, check, section, summarize, waitFor } from './client';

/**
 * §12 장애 시나리오 — 어댑터 실패 주입 시 재시도 → Fallback → 에스컬레이션이
 * 순서대로 발생하는지 확인한다 (M3 DoD).
 *
 * 워커를 MOCK_FAILURE_RATE=1 로 재기동한 뒤 실행한다:
 *   MOCK_FAILURE_RATE=1 pnpm start:worker
 *   pnpm ts-node -T -r tsconfig-paths/register test/e2e/failure-scenarios.e2e.ts
 */

const PASSWORD = 'crez1234!';

interface Task {
  id: string; kind: string; state: string; retryCount: number; maxRetry: number;
  events?: Array<{ fromState: string | null; toState: string; reason: string | null }>;
  error: { code?: string; message?: string } | null;
}

async function main(): Promise<void> {
  const operator = new Client();
  await operator.login('operator@crez.local', PASSWORD);

  const artists = await operator.get<Array<{ id: string; status: string }>>('/artists');
  const channels = await operator.get<Array<{ id: string; platform: string }>>('/channels');
  const agents = await operator.get<Array<{ id: string; kind: string; approvalLevel: number }>>('/agents');
  const artist = artists.find((a) => a.status === 'ACTIVE')!;
  const youtube = channels.find((c) => c.platform === 'YOUTUBE')!;
  const agent = agents.find((a) => a.kind === 'IMAGE')!;

  section('장애 주입 — 생성 어댑터가 계속 실패할 때');
  const order = await operator.post<{ id: string; orderNo: string }>('/orders', {
    artistId: artist.id, channelIds: [youtube.id], agentId: agent.id,
    outputType: 'IMAGE', quantity: 1,
    concept: { campaign: 'FAILTEST', mood: 'bright', story: 'retry_path' },
    design: { tone: 'warm', palette: ['#F2E7D5'], template: 'crez_basic_v1' },
    spec: { aspect: '9:16', resolution: '1080x1920' },
    assetFilter: { include: { outfit: ['casual'] } },
    budgetCapKrw: 300_000, approvalLevel: 1,
  }, { 'Idempotency-Key': `fail-${Date.now()}` });

  const submitted = await operator.post<{ order: { status: string } }>(`/orders/${order.id}/submit`);
  check('오더가 큐에 투입되었다', submitted.order.status === 'QUEUED', submitted.order.status);

  const generationTask = await waitFor(
    '생성 Task 가 최종 상태에 도달',
    async () => {
      const tasks = await operator.get<Task[]>(`/tasks?orderId=${order.id}&limit=50`);
      return tasks.find((t) => t.kind.startsWith('GENERATE')) ?? null;
    },
    (t) => Boolean(t && ['ESCALATED', 'FAILED', 'DONE'].includes(t.state)),
    { timeoutMs: 300_000, intervalMs: 3000 },
  );

  check('생성 Task 를 찾았다', Boolean(generationTask));
  if (!generationTask) return summarize();

  const detail = await operator.get<Task>(`/tasks/${generationTask.id}`);
  const states = (detail.events ?? []).map((e) => e.toState);
  console.log(`  상태 전이: ${states.join(' → ')}`);

  check('재시도가 발생했다', detail.retryCount > 0, detail.retryCount);
  check('RETRY 또는 FALLBACK 상태를 거쳤다',
    states.includes('RETRY') || states.includes('FALLBACK'), states);
  check('재시도 소진 후 ESCALATED 로 끝난다', detail.state === 'ESCALATED', detail.state);
  check('재시도 한도까지 갔다', detail.retryCount >= detail.maxRetry, {
    retryCount: detail.retryCount, maxRetry: detail.maxRetry,
  });
  check('실패 원인이 기록되었다', Boolean(detail.error), detail.error);

  // 수동 재시도를 하면 Task 가 ESCALATED 에서 빠져나오므로 노출 확인을 먼저 한다.
  section('에스컬레이션 노출 (§7.2)');
  const esc = await operator.get<{ tasks: Task[] }>('/dashboard/escalations');
  check('에스컬레이션 화면에 노출된다',
    esc.tasks.some((t) => t.id === generationTask.id), { listed: esc.tasks.length });

  section('수동 재시도 (§7.2 Task 모니터)');
  const retried = await operator.post<Task>(`/tasks/${generationTask.id}/retry`);
  check('에스컬레이션된 Task 를 수동 재시도할 수 있다',
    ['QUEUED', 'RUNNING', 'RETRY', 'ESCALATED', 'FAILED'].includes(retried.state), retried.state);

  const afterRetry = await operator.get<{ tasks: Task[] }>('/dashboard/escalations');
  check('재시도한 Task 는 에스컬레이션 목록에서 빠진다',
    !afterRetry.tasks.some((t) => t.id === generationTask.id && t.state === 'ESCALATED'), afterRetry.tasks.length);

  summarize();
}

void main().catch((err) => {
  console.error('\n\x1b[31m장애 시나리오 실행 실패\x1b[0m');
  console.error(err);
  process.exit(1);
});
