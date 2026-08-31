'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money, usePolling } from '@/components/ui';

interface Costs {
  days: number;
  byDay: Array<{ day: string; cost: number; calls: number }>;
  byProvider: Array<{ provider: string; cost: number; calls: number }>;
  byAgent: Array<{ agent_id: string; name: string; cost: number; daily_budget: number }>;
  avgCostPerContentKrw: number;
}

export default function CostsPage() {
  const [days, setDays] = useState(14);
  const { data, error } = usePolling<Costs>(
    () => api.get<Costs>(`/dashboard/costs?days=${days}`).then((r) => r.data), 0, [days],
  );
  const maxDay = data ? Math.max(1, ...data.byDay.map((d) => d.cost)) : 1;

  return (
    <Shell title="비용" subtitle="cost_logs 기준 실제 발생 비용입니다. 캐시 히트는 0원으로 기록됩니다.">
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        {[7, 14, 30, 90].map((d) => (
          <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>{d}일</button>
        ))}
      </div>
      {!data ? <div className="empty">불러오는 중…</div> : (
        <>
          <div className="grid cols-3">
            <div className="card kpi">
              <span className="value"><Money krw={data.byDay.reduce((s, d) => s + d.cost, 0)} /></span>
              <span className="label">{days}일 누적</span>
            </div>
            <div className="card kpi">
              <span className="value"><Money krw={Math.round(data.avgCostPerContentKrw)} /></span>
              <span className="label">콘텐츠 1건당 평균 원가</span>
            </div>
            <div className="card kpi">
              <span className="value">{data.byDay.reduce((s, d) => s + d.calls, 0).toLocaleString()}</span>
              <span className="label">외부 호출 수</span>
            </div>
          </div>

          <h2>일자별</h2>
          <div className="card">
            {data.byDay.length === 0 ? <div className="empty">기록이 없습니다.</div> : data.byDay.map((d) => (
              <div key={d.day} className="scorebar" style={{ marginBottom: 6 }}>
                <span className="sub mono" style={{ width: 92 }}>{String(d.day).slice(0, 10)}</span>
                <span className="track">
                  <span className="fill" style={{ width: `${(d.cost / maxDay) * 100}%`, background: 'var(--accent)' }} />
                </span>
                <span className="mono" style={{ width: 90, textAlign: 'right' }}>{d.cost.toLocaleString()}원</span>
                <span className="sub" style={{ width: 60, textAlign: 'right' }}>{d.calls}회</span>
              </div>
            ))}
          </div>

          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div className="card">
              <h3>어댑터별</h3>
              <table>
                <thead><tr><th>어댑터</th><th className="num">호출</th><th className="num">비용</th></tr></thead>
                <tbody>
                  {data.byProvider.map((p) => (
                    <tr key={p.provider}>
                      <td className="mono">{p.provider}</td>
                      <td className="num">{p.calls}</td>
                      <td className="num"><Money krw={p.cost} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>에이전트별</h3>
              <table>
                <thead><tr><th>에이전트</th><th className="num">비용</th><th className="num">일 예산</th></tr></thead>
                <tbody>
                  {data.byAgent.map((a) => (
                    <tr key={a.agent_id}>
                      <td>{a.name}</td>
                      <td className="num"><Money krw={a.cost} /></td>
                      <td className="num sub"><Money krw={a.daily_budget} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
