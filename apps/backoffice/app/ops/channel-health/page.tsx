'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, relTime, usePolling } from '@/components/ui';

interface ChannelHealth {
  id: string; platform: string; handle: string; status: string;
  healthState: 'ACTIVE' | 'THROTTLED' | 'QUARANTINE';
  dailyCap: number; minIntervalMin: number; observedSafeMax: number;
  quarantinedAt: string | null; quarantineReason: string | null;
  headroom: {
    available: number; reason: string; postedToday: number;
    minutesSinceLast: number | null; minIntervalMin: number;
  };
}
interface HealthDetail {
  headroom: ChannelHealth['headroom'];
  logs: Array<{ id: string; observedOn: string; postedCount: number; policyRemovals: number;
    dailyCap: number; stateAfter: string }>;
}

const REASON_KO: Record<string, string> = {
  OK: '게시 가능',
  QUARANTINE: '격리됨 — 게시 중단',
  THROTTLED_CAP_REACHED: '일일 상한 도달',
  MIN_INTERVAL: '최소 간격 미달',
  CHANNEL_INACTIVE: '채널 비활성',
};

export default function ChannelHealthPage() {
  const me = tokens.user;
  const admin = hasMinRole(me?.role, 'ADMIN');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const { data, error, reload } = usePolling<ChannelHealth[]>(
    () => api.get<ChannelHealth[]>('/channels/health').then((r) => r.data), 10000,
  );
  const { data: detail } = usePolling<HealthDetail | null>(
    () => (selected ? api.get<HealthDetail>(`/channels/${selected}/health`).then((r) => r.data) : Promise.resolve(null)),
    0, [selected],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await reload(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Shell
      title="채널 안전 게시"
      subtitle="생산 능력을 그대로 게시량으로 전환하면 플랫폼 탐지에 걸립니다. 한도는 내리는 쪽이 빠른 비대칭 설계입니다."
    >
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />

      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div> : (
          <table>
            <thead>
              <tr>
                <th>채널</th><th>건강 상태</th><th className="num">오늘 게시</th><th className="num">일일 상한</th>
                <th className="num">남은 여유</th><th>사유</th><th className="num">최소 간격</th><th>격리</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(selected === c.id ? null : c.id)}>
                  <td>
                    <span className="badge">{c.platform}</span> {c.handle}
                  </td>
                  <td><StatusBadge status={c.healthState} /></td>
                  <td className="num">{c.headroom.postedToday}</td>
                  <td className="num">{c.dailyCap}</td>
                  <td className="num" style={{ color: c.headroom.available > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    <strong>{c.headroom.available}</strong>
                  </td>
                  <td className="sub">{REASON_KO[c.headroom.reason] ?? c.headroom.reason}</td>
                  <td className="num sub">
                    {c.minIntervalMin}분
                    {c.headroom.minutesSinceLast !== null && ` (${Math.round(c.headroom.minutesSinceLast)}분 경과)`}
                  </td>
                  <td className="sub">{c.quarantineReason ?? '-'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row">
                      <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                        onClick={() => void act(() => api.post(`/channels/${c.id}/observe`, {}))}>관측</button>
                      {admin && c.healthState !== 'QUARANTINE' && (
                        <button className="danger" style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                          onClick={() => void act(() => api.post(`/channels/${c.id}/quarantine`, { reason: '백오피스에서 수동 격리' }))}>
                          격리
                        </button>
                      )}
                      {admin && c.healthState === 'QUARANTINE' && (
                        <button className="primary" style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                          onClick={() => void act(() => api.post(`/channels/${c.id}/release`, {}))}>
                          해제
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && detail && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>일일 관측 이력</h3>
          {detail.logs.length === 0 ? <div className="empty">관측 기록이 없습니다. 「관측」을 눌러 오늘치를 남기세요.</div> : (
            <table>
              <thead><tr><th>일자</th><th className="num">게시</th><th className="num">상한</th>
                <th className="num">정책 삭제</th><th>판정</th></tr></thead>
              <tbody>
                {detail.logs.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{String(l.observedOn).slice(0, 10)}</td>
                    <td className="num">{l.postedCount}</td>
                    <td className="num">{l.dailyCap}</td>
                    <td className="num" style={l.policyRemovals ? { color: 'var(--danger)' } : undefined}>{l.policyRemovals}</td>
                    <td><StatusBadge status={l.stateAfter} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="sub" style={{ marginTop: 10 }}>
            정책 삭제가 1건이라도 발생하면 즉시 격리되며 자동 재개하지 않습니다.
            도달률 기반 자동 조정(AIMD)은 Analytics 수집 이후 V2 입니다.
          </div>
        </div>
      )}
    </Shell>
  );
}
