'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money, Progress, StatusBadge, duration, relTime, usePolling } from '@/components/ui';

interface OrderDetail {
  id: string; orderNo: string; status: string; outputType: string; quantity: number;
  budgetCap: number; approvalLevel: number; scheduledAt: string | null; createdAt: string;
  concept: Record<string, unknown>; design: Record<string, unknown>;
  spec: Record<string, unknown>; assetFilter: Record<string, unknown>;
  rejectReason: Array<{ code: string; detail: unknown }> | null;
  artist?: { name: string; code: string } | null;
  agent?: { name: string; approvalLevel: number } | null;
  requester?: { name: string; email: string } | null;
  channels?: Array<{ id: string; handle: string; platform: string; region: string | null }>;
  selections: Array<{ id: string; rank: number; fitScore: number; assetId: string;
    reason: { matched: Record<string, string[]>; validUntil: string; breakdown?: Record<string, number> };
    asset?: { attributes: Record<string, string>; qualityGrade: string } }>;
  blueprints: Array<{ id: string; seq: number; outputType: string; channelId: string; scenePlan: unknown[] }>;
  contents: Array<{ id: string; status: string; outputType: string; title: string | null; durationMs: number | null }>;
  tasks: Array<{ id: string; kind: string; state: string; retryCount: number; maxRetry: number; queuedAt: string }>;
  estimate: { totalKrw: number; perContentKrw: number; contentCount: number; breakdown: Record<string, number> };
  progress: { total: number; published: number; failed: number; percent: number; stages: Record<string, number> };
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const { data, error, reload } = usePolling<OrderDetail>(
    () => api.get<OrderDetail>(`/orders/${id}`).then((r) => r.data), 5000, [id],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await reload(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  if (!data) return <Shell title="오더"><ErrorBox error={error} /><div className="empty">불러오는 중…</div></Shell>;

  const canSubmit = ['DRAFT', 'REJECTED'].includes(data.status);
  const canCancel = !['DONE', 'CANCELLED'].includes(data.status);

  return (
    <Shell
      title={data.orderNo}
      subtitle={`${data.artist?.name ?? ''} · ${data.outputType} · 수량 ${data.quantity} · 요청 ${data.requester?.name ?? ''}`}
      actions={
        <>
          {canSubmit && <button className="primary" disabled={busy}
            onClick={() => void act(() => api.post(`/orders/${id}/submit`, {}))}>검증 후 제출</button>}
          <button disabled={busy} onClick={() => void act(() => api.post(`/orders/${id}/validate`, {}))}>사전 검증</button>
          {canCancel && <button className="danger" disabled={busy}
            onClick={() => void act(() => api.post(`/orders/${id}/cancel`, { reason: '운영자 취소' }))}>취소</button>}
        </>
      }
    >
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />

      <div className="grid cols-4">
        <div className="card kpi"><span className="value"><StatusBadge status={data.status} /></span><span className="label">상태</span></div>
        <div className="card kpi"><span className="value">{data.progress.percent}%</span><span className="label">진행률 (게시 {data.progress.published}/{data.progress.total})</span></div>
        <div className="card kpi"><span className="value"><Money krw={data.estimate.totalKrw} /></span><span className="label">예상 비용 · 상한 <Money krw={data.budgetCap} /></span></div>
        <div className="card kpi"><span className="value">L{data.agent?.approvalLevel ?? data.approvalLevel}</span><span className="label">승인 레벨 {data.agent ? `(${data.agent.name})` : '(오더 지정)'}</span></div>
      </div>

      {data.rejectReason && (
        <div className="error" style={{ marginTop: 12 }}>
          <strong>검증 반려 사유</strong>
          <pre style={{ marginTop: 8, marginBottom: 0 }}>{JSON.stringify(data.rejectReason, null, 2)}</pre>
        </div>
      )}

      <h2>5단계 진행</h2>
      <div className="card">
        <Progress percent={data.progress.percent} />
        <div className="row" style={{ marginTop: 10 }}>
          {Object.entries(data.progress.stages).map(([stage, n]) => (
            <span key={stage} className={`badge ${n > 0 ? 'info' : ''}`}>{stage} {n}</span>
          ))}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>오더 사양</h3>
          <table>
            <tbody>
              <tr><th>채널</th><td>{(data.channels ?? []).map((c) => `${c.platform} ${c.handle} (${c.region})`).join(', ')}</td></tr>
              <tr><th>컨셉</th><td className="mono">{JSON.stringify(data.concept)}</td></tr>
              <tr><th>디자인</th><td className="mono">{JSON.stringify(data.design)}</td></tr>
              <tr><th>사양</th><td className="mono">{JSON.stringify(data.spec)}</td></tr>
              <tr><th>자산 조건</th><td className="mono">{JSON.stringify(data.assetFilter)}</td></tr>
              <tr><th>게시 예정</th><td>{data.scheduledAt ? new Date(data.scheduledAt).toLocaleString('ko-KR') : '-'}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>예상 비용 내역</h3>
          <table>
            <tbody>
              {Object.entries(data.estimate.breakdown).map(([k, v]) => (
                <tr key={k}><th>{k}</th><td className="num"><Money krw={v} /></td></tr>
              ))}
              <tr><th>콘텐츠 1건당</th><td className="num"><Money krw={data.estimate.perContentKrw} /></td></tr>
              <tr><th>총 {data.estimate.contentCount}건</th><td className="num"><strong><Money krw={data.estimate.totalKrw} /></strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>선별 결과 ({data.selections.length}건)</h2>
      <div className="card">
        {data.selections.length === 0 ? <div className="empty">아직 선별되지 않았습니다.</div> : (
          <table>
            <thead>
              <tr><th className="num">순위</th><th className="num">적합도</th><th>속성</th><th>등급</th>
                <th>일치 항목</th><th>라이선스 만료</th><th>세부 점수</th></tr>
            </thead>
            <tbody>
              {data.selections.slice(0, 20).map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.rank}</td>
                  <td className="num"><strong>{s.fitScore}</strong></td>
                  <td className="sub mono">{Object.entries(s.asset?.attributes ?? {}).map(([k, v]) => `${k}:${v}`).join(' ')}</td>
                  <td><span className="badge">{s.asset?.qualityGrade}</span></td>
                  <td className="sub">{Object.keys(s.reason.matched ?? {}).join(', ') || '-'}</td>
                  <td className="sub">{s.reason.validUntil}</td>
                  <td className="sub mono">
                    {s.reason.breakdown
                      ? Object.entries(s.reason.breakdown).map(([k, v]) => `${k[0]}${k[1]}:${v}`).join(' ')
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>산출물 ({data.contents.length}건)</h2>
      <div className="card">
        {data.contents.length === 0 ? <div className="empty">아직 콘텐츠가 없습니다.</div> : (
          <table>
            <thead><tr><th>콘텐츠</th><th>유형</th><th>제목</th><th>길이</th><th>상태</th></tr></thead>
            <tbody>
              {data.contents.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/contents/${c.id}`} className="mono">{c.id.slice(0, 8)}</Link></td>
                  <td><span className="badge">{c.outputType}</span></td>
                  <td>{c.title ?? '-'}</td>
                  <td className="sub">{duration(c.durationMs)}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Task ({data.tasks.length}건)</h2>
      <div className="card">
        <table>
          <thead><tr><th>Task</th><th>종류</th><th>상태</th><th>재시도</th><th>큐 투입</th></tr></thead>
          <tbody>
            {data.tasks.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/ops/tasks?taskId=${t.id}`} className="mono">{t.id.slice(0, 8)}</Link></td>
                <td><span className="badge">{t.kind}</span></td>
                <td><StatusBadge status={t.state} /></td>
                <td className="sub">{t.retryCount} / {t.maxRetry}</td>
                <td className="sub">{relTime(t.queuedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
