import { Client, check, section, summarize, waitFor } from './client';

/**
 * §12 E2E — 오더 제출 → 게시까지, Mock 어댑터 기준.
 * 실제 API 를 HTTP 로 두드리므로 API·오케스트레이터·워커가 모두 떠 있어야 한다.
 *
 *   pnpm infra:up && pnpm db:migrate && pnpm db:seed
 *   pnpm start:api & pnpm start:orchestrator & pnpm start:worker &
 *   pnpm test:e2e
 */

const PASSWORD = 'crez1234!';

interface Artist { id: string; name: string; status: string }
interface Channel { id: string; platform: string; handle: string; region: string | null }
interface Agent { id: string; name: string; kind: string; approvalLevel: number; lifecycle: string }
interface Order { id: string; orderNo: string; status: string }
interface Validation { ok: boolean; errors: Array<{ code: string }>; estimatedCostKrw: number; candidateCount: number }
interface Content {
  id: string; status: string; outputType: string; finalKey: string | null; durationMs: number | null;
  costKrw: number;
  qc: { verdict: string; totalScore: number; areaScores: Record<string, number>; violations: unknown[] } | null;
  scenes: Array<{ id: string; seq: number; status: string; sourceType: string }>;
  lineage: { sourceAssetIds: string[] };
  publications: Array<{ id: string; status: string; visibility: string; externalUrl: string | null }>;
  approvals: Array<{ decision: string; auto: boolean; levelAt: number }>;
}

async function main(): Promise<void> {
  const operator = new Client();
  const reviewer = new Client();

  section('0. 인증 및 RBAC (§6)');
  const op = await operator.login('operator@crez.local', PASSWORD);
  check('OPERATOR 로그인', op.role === 'OPERATOR');
  const rv = await reviewer.login('reviewer@crez.local', PASSWORD);
  check('REVIEWER 로그인', rv.role === 'REVIEWER');

  let forbidden = false;
  try { await operator.get('/users'); } catch (e) { forbidden = (e as { code: string }).code === 'AUTH_FORBIDDEN'; }
  check('OPERATOR 는 사용자 관리에 접근할 수 없다 (AUTH_FORBIDDEN)', forbidden);

  const artists = await operator.get<Artist[]>('/artists');
  const channels = await operator.get<Channel[]>('/channels');
  const agents = await operator.get<Agent[]>('/agents');
  const artist = artists.find((a) => a.status === 'ACTIVE')!;
  const youtube = channels.find((c) => c.platform === 'YOUTUBE')!;
  const jp = channels.find((c) => c.region === 'JP')!;
  const agent = agents.find((a) => a.kind === 'VIDEO' && a.approvalLevel === 2)!;
  check('시드 데이터 확보 (아티스트·채널·에이전트)', Boolean(artist && youtube && jp && agent));

  section('1. 실시간 후보 수 (§7.2 오더 콘솔 5단계)');
  const preview = await operator.post<{ total: number; byChannel: Array<{ channelId: string; usable: number }> }>(
    '/orders/preview-candidates',
    {
      artistId: artist.id,
      channelIds: [youtube.id, jp.id],
      assetFilter: { include: { outfit: ['casual'] }, exclude: { angle: ['back'] } },
    },
  );
  check('조건에 맞는 후보가 존재한다', preview.total > 0, preview);
  check('KR 전용 라이선스 때문에 JP 채널 사용 가능 자산은 0건',
    preview.byChannel.find((b) => b.channelId === jp.id)?.usable === 0, preview.byChannel);

  section('2. Order Validator (§4.2)');
  const badOrder = await operator.post<Order>('/orders', {
    artistId: artist.id, channelIds: [youtube.id, jp.id], agentId: agent.id,
    outputType: 'VIDEO', quantity: 1,
    concept: { campaign: 'E2E', mood: 'bright', story: 'license_test' },
    design: { tone: 'warm', palette: ['#F2E7D5'], template: 'crez_basic_v1' },
    spec: { aspect: '9:16', durationSec: 12, resolution: '1080x1920' },
    assetFilter: { include: { outfit: ['casual'] }, exclude: { angle: ['back'] } },
    budgetCapKrw: 300_000, approvalLevel: 2,
  }, { 'Idempotency-Key': `e2e-bad-${Date.now()}` });

  const badValidation = await operator.post<Validation>(`/orders/${badOrder.id}/validate`);
  check('JP 채널 포함 오더는 LICENSE_CHANNEL_DENIED 로 반려된다',
    !badValidation.ok && badValidation.errors.some((e) => e.code === 'LICENSE_CHANNEL_DENIED'), badValidation.errors);

  const overBudget = await operator.post<Order>('/orders', {
    artistId: artist.id, channelIds: [youtube.id], agentId: agent.id,
    outputType: 'VIDEO', quantity: 5,
    concept: { campaign: 'E2E' }, design: {}, spec: { aspect: '9:16', durationSec: 30, resolution: '1080x1920' },
    assetFilter: { include: { outfit: ['casual'] } },
    budgetCapKrw: 100, approvalLevel: 2,
  }, { 'Idempotency-Key': `e2e-budget-${Date.now()}` });
  const budgetValidation = await operator.post<Validation>(`/orders/${overBudget.id}/validate`);
  check('예산 상한을 넘으면 BUDGET_EXCEEDED',
    !budgetValidation.ok && budgetValidation.errors.some((e) => e.code === 'BUDGET_EXCEEDED'), budgetValidation.errors);

  const specMismatch = await operator.post<Order>('/orders', {
    artistId: artist.id, channelIds: [youtube.id], agentId: agent.id,
    outputType: 'VIDEO', quantity: 1,
    concept: {}, design: {}, spec: { aspect: '16:9', durationSec: 12, resolution: '1920x1080' },
    assetFilter: { include: { outfit: ['casual'] } },
    budgetCapKrw: 300_000, approvalLevel: 2,
  }, { 'Idempotency-Key': `e2e-spec-${Date.now()}` });
  const specValidation = await operator.post<Validation>(`/orders/${specMismatch.id}/validate`);
  check('채널 규격과 다른 화면비는 SPEC_MISMATCH',
    !specValidation.ok && specValidation.errors.some((e) => e.code === 'SPEC_MISMATCH'), specValidation.errors);

  section('3. 멱등성 (§5.1)');
  const idemKey = `e2e-idem-${Date.now()}`;
  const body = {
    artistId: artist.id, channelIds: [youtube.id], agentId: agent.id,
    outputType: 'VIDEO', quantity: 1,
    concept: { campaign: '2026SS', mood: 'bright', story: 'airport_fashion' },
    design: { tone: 'warm', palette: ['#F2E7D5', '#2B2B2B'], template: 'crez_basic_v1' },
    spec: { aspect: '9:16', durationSec: 12, resolution: '1080x1920' },
    assetFilter: { include: { outfit: ['casual'] }, exclude: { angle: ['back'] } },
    budgetCapKrw: 300_000, approvalLevel: 2,
  };
  const first = await operator.post<Order>('/orders', body, { 'Idempotency-Key': idemKey });
  const second = await operator.post<Order>('/orders', body, { 'Idempotency-Key': idemKey });
  check('같은 Idempotency-Key 는 같은 오더를 돌려준다', first.id === second.id);

  section('4. 제출 → 게시 파이프라인 (§3)');
  const submitted = await operator.post<{ order: Order; validation: Validation }>(`/orders/${first.id}/submit`);
  check('검증 통과 후 QUEUED', submitted.order.status === 'QUEUED', submitted.order);
  check('예상 비용이 산출된다', submitted.validation.estimatedCostKrw > 0, submitted.validation);

  const withContents = await waitFor(
    '콘텐츠 생성',
    () => operator.get<{ contents: Array<{ id: string }> }>(`/orders/${first.id}`),
    (o) => o.contents.length > 0,
    { timeoutMs: 90_000 },
  );
  const contentId = withContents.contents[0].id;
  check('블루프린트 팬아웃으로 콘텐츠가 만들어졌다', Boolean(contentId));

  const content = await waitFor(
    '콘텐츠 게시',
    () => operator.get<Content>(`/contents/${contentId}`),
    (c) => ['PUBLISHED', 'READY', 'BLOCKED', 'QC_FAILED', 'FAILED'].includes(c.status),
    { timeoutMs: 300_000 },
  );

  check('콘텐츠가 PUBLISHED 에 도달했다', content.status === 'PUBLISHED', { status: content.status });
  check('최종 산출물 키가 있다', Boolean(content.finalKey));
  check('영상 길이가 기록되었다', (content.durationMs ?? 0) > 0, content.durationMs);
  check('Scene 이 모두 완료되었다', content.scenes.length > 0 && content.scenes.every((s) => s.status === 'DONE'),
    content.scenes.map((s) => s.status));

  section('5. QC (§4.6)');
  check('QC 결과가 기록되었다', Boolean(content.qc));
  check('QC 판정은 PASS', content.qc?.verdict === 'PASS', content.qc?.verdict);
  check('6개 영역 점수가 모두 있다',
    ['quality', 'identity', 'brand', 'policy', 'copyright', 'aiRisk']
      .every((a) => typeof content.qc?.areaScores?.[a] === 'number'), content.qc?.areaScores);
  check('총점이 기준(80) 이상', (content.qc?.totalScore ?? 0) >= 80, content.qc?.totalScore);

  section('6. 승인 (§4.7)');
  check('레벨 2 에이전트는 자동 승인된다',
    content.approvals.some((a) => a.auto && a.decision === 'APPROVED' && a.levelAt === 2), content.approvals);

  section('7. 계보 (§2.1)');
  check('사용된 원본 자산이 기록되었다', content.lineage.sourceAssetIds.length > 0, content.lineage);

  section('8. 게시 (§4.8)');
  const pub = content.publications[0];
  check('게시 기록이 있다', Boolean(pub));
  check('V1 은 비공개 업로드 고정', pub?.visibility === 'PRIVATE', pub?.visibility);
  check('외부 URL 이 저장되었다', Boolean(pub?.externalUrl));

  section('9. 4-eyes 원칙 (§6.2)');
  // operator 가 만든 오더의 콘텐츠를 operator 본인이 승인 시도 → 거부되어야 한다.
  // 이미 PUBLISHED 라 상태 전이로 먼저 막히므로, 새 콘텐츠를 READY 로 만들어 확인한다.
  const l0Agent = agents.find((a) => a.approvalLevel === 0);
  if (l0Agent) {
    const manualOrder = await operator.post<Order>('/orders', {
      ...body, agentId: l0Agent.id, quantity: 1, outputType: 'IMAGE',
    }, { 'Idempotency-Key': `e2e-manual-${Date.now()}` });
    const manualSubmit = await operator.post<{ order: Order; validation: Validation }>(`/orders/${manualOrder.id}/submit`);

    if (manualSubmit.order.status === 'QUEUED') {
      const o = await waitFor('수동승인 콘텐츠 생성',
        () => operator.get<{ contents: Array<{ id: string }> }>(`/orders/${manualOrder.id}`),
        (x) => x.contents.length > 0, { timeoutMs: 90_000 });
      const manualContentId = o.contents[0].id;
      const ready = await waitFor('승인 대기 상태 도달',
        () => operator.get<Content>(`/contents/${manualContentId}`),
        (c) => ['READY', 'BLOCKED', 'QC_FAILED', 'FAILED', 'PUBLISHED'].includes(c.status),
        { timeoutMs: 240_000 });

      check('레벨 0 에이전트는 자동 승인되지 않고 READY 로 대기한다', ready.status === 'READY', ready.status);

      if (ready.status === 'READY') {
        let selfDenied = false;
        try { await operator.post(`/contents/${manualContentId}/approve`, {}); }
        catch (e) { selfDenied = (e as { code: string }).code === 'SELF_APPROVAL_DENIED' || (e as { code: string }).code === 'AUTH_FORBIDDEN'; }
        check('본인 오더 자기 승인은 거부된다', selfDenied);

        const approved = await reviewer.post<Content>(`/contents/${manualContentId}/approve`, { comment: 'E2E 승인' });
        check('REVIEWER 는 승인할 수 있다', approved.status === 'APPROVED', approved.status);

        const published = await waitFor('수동 승인 후 게시',
          () => reviewer.get<Content>(`/contents/${manualContentId}`),
          (c) => c.publications.length > 0 && ['UPLOADED', 'PUBLISHED'].includes(c.publications[0].status),
          { timeoutMs: 120_000 });
        check('승인 후 자동으로 게시된다', published.publications[0].visibility === 'PRIVATE');

        section('10. 공개 전환 (§4.8 5단계)');
        const publicized = await reviewer.post<{ visibility: string; status: string }>(
          `/publications/${published.publications[0].id}/publicize`, { visibility: 'PUBLIC' },
        );
        check('운영자가 비공개 → 공개로 전환할 수 있다',
          publicized.visibility === 'PUBLIC' && publicized.status === 'PUBLISHED', publicized);
      }
    } else {
      check('수동 승인 오더 제출', false, manualSubmit.order.status);
    }
  }

  section('11. 비용 기록 (§9.4)');
  const costs = await operator.get<{ byProvider: Array<{ provider: string; cost: number }> }>('/dashboard/costs?days=1');
  check('어댑터별 비용이 집계된다', costs.byProvider.length > 0, costs.byProvider);
  check('콘텐츠 단위 원가가 기록되었다', content.costKrw > 0, content.costKrw);

  section('12. 오더 마감');
  const finished = await waitFor('오더 마감',
    () => operator.get<{ status: string; progress: { percent: number } }>(`/orders/${first.id}`),
    (o) => ['DONE', 'PARTIAL'].includes(o.status), { timeoutMs: 60_000 });
  check('모든 콘텐츠 종료 후 오더가 마감된다', finished.status === 'DONE', finished.status);

  summarize();
}

void main().catch((err) => {
  console.error('\n\x1b[31mE2E 실행 실패\x1b[0m');
  console.error(err);
  process.exit(1);
});
