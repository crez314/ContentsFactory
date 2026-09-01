'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, usePolling } from '@/components/ui';

interface Metric {
  key: string; label: string; value: number | null;
  formula: string; source: string; sampleSize?: number | null;
}
interface Metrics { windowDays: number; metrics: Metric[] }

/** 지표별 표시 형식. 산식은 API 가 단일 출처이므로 여기서는 포맷만 담당한다. */
const FORMAT: Record<string, (v: number) => string> = {
  leadTimeSec: (v) => v < 60 ? `${v.toFixed(1)}초` : v < 3600 ? `${(v / 60).toFixed(1)}분` : `${(v / 3600).toFixed(1)}시간`,
  unitCostKrw: (v) => `${Math.round(v).toLocaleString('ko-KR')}원`,
  blockedSavingKrw: (v) => `${Math.round(v).toLocaleString('ko-KR')}원`,
  contentsPerShoot: (v) => `${v.toFixed(1)}건`,
  identityScore: (v) => v.toFixed(2),
  successRate: (v) => `${(v * 100).toFixed(1)}%`,
  automationRate: (v) => `${(v * 100).toFixed(1)}%`,
  reworkRate: (v) => `${(v * 100).toFixed(1)}%`,
  qcAccuracy: (v) => `${(v * 100).toFixed(1)}%`,
  orderExecRate: (v) => `${(v * 100).toFixed(1)}%`,
};

export default function MetricsPage() {
  const [days, setDays] = useState(30);
  const { data, error } = usePolling<Metrics>(
    () => api.get<Metrics>(`/metrics?days=${days}`).then((r) => r.data), 0, [days],
  );

  return (
    <Shell
      title="운영 지표"
      subtitle="산식과 소스 테이블이 고정되어 있습니다. 화면이나 보고서에서 따로 계산하지 않습니다."
    >
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        {[7, 30, 90, 365].map((d) => (
          <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>{d}일</button>
        ))}
      </div>

      {!data ? <div className="empty">불러오는 중…</div> : (
        <>
          <div className="grid cols-4">
            {data.metrics.slice(0, 4).map((m) => (
              <div className="card kpi" key={m.key}>
                <span className="value">
                  {m.value === null ? '—' : (FORMAT[m.key]?.(m.value) ?? m.value.toFixed(2))}
                </span>
                <span className="label">{m.label}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>지표</th><th className="num">값</th><th>산식</th><th>소스</th></tr></thead>
              <tbody>
                {data.metrics.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num">
                      <strong>{m.value === null ? '—' : (FORMAT[m.key]?.(m.value) ?? m.value.toFixed(2))}</strong>
                      {m.sampleSize != null && <span className="sub"> (n={m.sampleSize})</span>}
                    </td>
                    <td className="sub mono">{m.formula}</td>
                    <td className="sub mono">{m.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>실패 이력 보존</h3>
            <p className="sub" style={{ margin: 0 }}>
              task_events 와 qc_results 의 실패 레코드는 삭제하지 않습니다.
              시장에서 구할 수 없고 운영으로만 축적되는 데이터이므로,
              V2 리스크 스코어러의 학습 입력으로 쓰기 위해 처음부터 남깁니다.
            </p>
          </div>
        </>
      )}
    </Shell>
  );
}
