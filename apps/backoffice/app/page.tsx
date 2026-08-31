'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money, Progress, StatusBadge, relTime, usePolling } from '@/components/ui';

interface Summary {
  kpi: {
    ordersToday: number; generating: number; awaitingApproval: number;
    published: number; failed: number; costTodayKrw: number; costMonthKrw: number; escalated: number;
  };
  runningOrders: Array<{
    id: string; orderNo: string; artistName: string | null; status: string;
    outputType: string; counts: Record<string, number>; total: number; percent: number;
  }>;
  attention: {
    escalatedTasks: Array<{ id: string; kind: string; state: string; updatedAt: string }>;
    budgetPausedAgents: Array<{ id: string; name: string; dailyBudget: number }>;
    expiringLicenses: Array<{ assetId: string; validUntil: string }>;
    alerts: Array<{ id: string; level: string; code: string; at: string; detail: Record<string, unknown> }>;
  };
  system: {
    queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number }>;
    adapters: Array<{ name: string; capability: string; healthy: boolean; unitCostKrw: number }>;
    services: Record<string, string>;
    env: string;
    storageDriver: string;
  };
}

export default function DashboardPage() {
  // 대시보드는 계속 변하므로 5초 폴링한다.
  const { data, error } = usePolling<Summary>(
    () => api.get<Summary>('/dashboard/summary').then((r) => r.data), 5000,
  );

  return (
    <Shell title="대시보드" subtitle="오더 → 생성 → QC → 승인 → 게시">
      <ErrorBox error={error} />
      {!data ? <div className="empty">불러오는 중…</div> : (
        <>
          <div className="grid cols-4">
            <Kpi label="오늘 오더" value={data.kpi.ordersToday} />
            <Kpi label="생성 중" value={data.kpi.generating} />
            <Kpi label="승인 대기" value={data.kpi.awaitingApproval} href="/contents/approval-queue" />
            <Kpi label="게시 완료" value={data.kpi.published} />
          </div>
          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <Kpi label="실패" value={data.kpi.failed} href="/ops/escalations" tone={data.kpi.failed ? 'danger' : undefined} />
            <Kpi label="에스컬레이션" value={data.kpi.escalated} href="/ops/escalations" tone={data.kpi.escalated ? 'warn' : undefined} />
            <Kpi label="오늘 비용" value={<Money krw={data.kpi.costTodayKrw} />} href="/ops/costs" />
            <Kpi label="이번 달 비용" value={<Money krw={data.kpi.costMonthKrw} />} href="/ops/costs" />
          </div>

          <h2>진행 중 오더</h2>
          <div className="card">
            {data.runningOrders.length === 0 ? <div className="empty">진행 중인 오더가 없습니다.</div> : (
              <table>
                <thead>
                  <tr><th>오더</th><th>아티스트</th><th>상태</th><th>산출물</th><th style={{ width: 220 }}>진행률</th><th className="num">콘텐츠</th></tr>
                </thead>
                <tbody>
                  {data.runningOrders.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/orders/${o.id}`} className="mono">{o.orderNo}</Link></td>
                      <td>{o.artistName ?? '-'}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td><span className="badge">{o.outputType}</span></td>
                      <td>
                        <Progress percent={o.percent} />
                        <div className="sub" style={{ marginTop: 3 }}>
                          {Object.entries(o.counts).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'}
                        </div>
                      </td>
                      <td className="num">{o.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div className="card">
              <h3>주의 필요</h3>
              <Attention a={data.attention} />
            </div>
            <div className="card">
              <h3>시스템 상태</h3>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="badge info">env {data.system.env}</span>
                <span className="badge">storage {data.system.storageDriver}</span>
                {Object.entries(data.system.services ?? {}).map(([svc, at]) => (
                  <span key={svc} className={`badge ${Date.now() - new Date(at).getTime() < 30000 ? 'ok' : 'danger'}`}>
                    {svc} {relTime(at)}
                  </span>
                ))}
              </div>
              <table>
                <thead><tr><th>큐</th><th className="num">대기</th><th className="num">실행</th><th className="num">지연</th><th className="num">실패</th></tr></thead>
                <tbody>
                  {data.system.queues.map((q) => (
                    <tr key={q.name}>
                      <td className="mono">{q.name}</td>
                      <td className="num">{q.waiting}</td>
                      <td className="num">{q.active}</td>
                      <td className="num">{q.delayed}</td>
                      <td className="num">{q.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 style={{ marginTop: 14 }}>어댑터 health</h3>
              <div className="row">
                {data.system.adapters.map((a) => (
                  <span key={a.name} className={`badge ${a.healthy ? 'ok' : 'danger'}`}>
                    {a.name} · {a.capability} · {a.unitCostKrw}원
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Kpi({ label, value, href, tone }: { label: string; value: React.ReactNode; href?: string; tone?: string }) {
  const body = (
    <div className="card kpi">
      <span className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      <span className="label">{label}</span>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Attention({ a }: { a: Summary['attention'] }) {
  const empty = !a.escalatedTasks.length && !a.budgetPausedAgents.length && !a.expiringLicenses.length && !a.alerts.length;
  if (empty) return <div className="empty">주의가 필요한 항목이 없습니다.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {a.escalatedTasks.length > 0 && (
        <div>
          <div className="sub">에스컬레이션 Task {a.escalatedTasks.length}건</div>
          {a.escalatedTasks.slice(0, 5).map((t) => (
            <div key={t.id} className="row" style={{ marginTop: 4 }}>
              <span className="badge danger">{t.kind}</span>
              <Link href={`/ops/tasks?taskId=${t.id}`} className="mono">{t.id.slice(0, 8)}</Link>
              <span className="sub">{relTime(t.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
      {a.budgetPausedAgents.length > 0 && (
        <div>
          <div className="sub">예산 소진으로 정지된 에이전트</div>
          {a.budgetPausedAgents.map((g) => (
            <div key={g.id} className="row" style={{ marginTop: 4 }}>
              <span className="badge warn">PAUSED_BUDGET</span>
              <Link href="/settings/agents">{g.name}</Link>
              <span className="sub"><Money krw={g.dailyBudget} />/일</span>
            </div>
          ))}
        </div>
      )}
      {a.expiringLicenses.length > 0 && (
        <div>
          <div className="sub">30일 내 만료 라이선스 {a.expiringLicenses.length}건</div>
          <div className="row" style={{ marginTop: 4 }}>
            {a.expiringLicenses.slice(0, 6).map((l) => (
              <Link key={l.assetId} href={`/assets?assetId=${l.assetId}`} className="badge warn">{l.validUntil}</Link>
            ))}
            <Link href="/assets/licenses" className="badge">전체 보기</Link>
          </div>
        </div>
      )}
      {a.alerts.length > 0 && (
        <div>
          <div className="sub">최근 알림</div>
          {a.alerts.slice(0, 6).map((al) => (
            <div key={al.id} className="row" style={{ marginTop: 4 }}>
              <span className={`badge ${al.level === 'CRITICAL' ? 'danger' : al.level === 'WARN' ? 'warn' : 'info'}`}>{al.code}</span>
              <span className="sub">{relTime(al.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
