'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money, StatusBadge, usePolling } from '@/components/ui';

interface Agent {
  id: string; name: string; kind: string; approvalLevel: number;
  dailyBudget: number; monthlyBudget: number; lifecycle: string; profile: Record<string, unknown>;
}
interface Stats {
  spentToday: number; spentMonth: number; dailyRemaining: number;
  contentCount: number; publishedCount: number; blockedCount: number;
  autoApprovedRatio: number; avgQcScore: number | null; qcPassRate: number | null;
}

const LEVELS = [
  'L0 전건 수동 승인',
  'L1 92점 이상 + 위반 없음 자동',
  'L2 85점 이상 자동',
  'L3 QC PASS 전건 자동',
];

export default function AgentsPage() {
  const me = tokens.user;
  const admin = hasMinRole(me?.role, 'ADMIN');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const { data, error, reload } = usePolling<Agent[]>(() => api.get<Agent[]>('/agents').then((r) => r.data), 0);
  const { data: stats } = usePolling<(Stats & { agent: Agent }) | null>(
    () => (selected ? api.get<Stats & { agent: Agent }>(`/agents/${selected}/stats`).then((r) => r.data) : Promise.resolve(null)),
    0, [selected],
  );

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setActionError(null);
    try { await api.patch(`/agents/${id}`, body); await reload(); }
    catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Shell title="에이전트" subtitle="V1 에서 승인 레벨은 운영자가 수동 설정합니다. 실적 기반 자동 상향은 V2 입니다.">
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div> : (
          <table>
            <thead>
              <tr><th>이름</th><th>종류</th><th>승인 레벨</th><th className="num">일 예산</th>
                <th className="num">월 예산</th><th>생애주기</th><th></th></tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td><span className="badge">{a.kind}</span></td>
                  <td>
                    {admin ? (
                      <select style={{ width: 230 }} value={a.approvalLevel} disabled={busy}
                        onChange={(e) => void patch(a.id, { approvalLevel: Number(e.target.value) })}>
                        {LEVELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                      </select>
                    ) : <span className="badge">L{a.approvalLevel}</span>}
                  </td>
                  <td className="num"><Money krw={a.dailyBudget} /></td>
                  <td className="num"><Money krw={a.monthlyBudget} /></td>
                  <td><StatusBadge status={a.lifecycle} /></td>
                  <td>
                    <div className="row">
                      <button style={{ padding: '3px 8px', fontSize: 12 }}
                        onClick={() => setSelected(selected === a.id ? null : a.id)}>실적</button>
                      {admin && a.lifecycle === 'PAUSED_BUDGET' && (
                        <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                          onClick={() => void patch(a.id, { lifecycle: 'ACTIVE' })}>재개</button>
                      )}
                      {admin && a.lifecycle === 'ACTIVE' && (
                        <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                          onClick={() => void patch(a.id, { lifecycle: 'PAUSED' })}>정지</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && stats && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{stats.agent.name} 실적 — V2 승인 레벨 자동 상향의 입력</h3>
          <div className="grid cols-4">
            <div className="kpi"><span className="value"><Money krw={stats.spentToday} /></span><span className="label">오늘 사용</span></div>
            <div className="kpi"><span className="value"><Money krw={stats.dailyRemaining} /></span><span className="label">일 잔여</span></div>
            <div className="kpi"><span className="value">{stats.contentCount}</span><span className="label">콘텐츠</span></div>
            <div className="kpi"><span className="value">{stats.publishedCount}</span><span className="label">게시</span></div>
          </div>
          <div className="grid cols-4" style={{ marginTop: 10 }}>
            <div className="kpi"><span className="value">{stats.avgQcScore != null ? stats.avgQcScore.toFixed(1) : '-'}</span><span className="label">평균 QC 점수</span></div>
            <div className="kpi"><span className="value">{stats.qcPassRate != null ? `${(stats.qcPassRate * 100).toFixed(0)}%` : '-'}</span><span className="label">QC 통과율</span></div>
            <div className="kpi"><span className="value">{(stats.autoApprovedRatio * 100).toFixed(0)}%</span><span className="label">자동 승인 비율</span></div>
            <div className="kpi"><span className="value" style={{ color: stats.blockedCount ? 'var(--danger)' : undefined }}>{stats.blockedCount}</span><span className="label">차단</span></div>
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            V2 착수 조건: 이 에이전트의 실적 30건 이상 누적.  현재 {stats.contentCount}건.
          </div>
        </div>
      )}
    </Shell>
  );
}
