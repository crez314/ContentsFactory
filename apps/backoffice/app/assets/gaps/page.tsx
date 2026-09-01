'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, relTime, usePolling } from '@/components/ui';

interface Gap {
  requested_attributes: Record<string, string[]>;
  reason: string;
  gap_count: number;
  best_fit_score: number | null;
  last_seen: string;
  artist_name: string;
  artist_id: string;
}

const REASON_KO: Record<string, string> = {
  NO_ELIGIBLE_ASSET: '라이선스·정책 조건을 만족하는 자산 없음',
  INSUFFICIENT_COVERAGE: '적합도 최저 기준 미달',
};

/**
 * §4.3 커버리지 부족.
 * 반려는 시스템 실패가 아니라 촬영 계획의 입력이다.
 */
export default function CoverageGapsPage() {
  const [days, setDays] = useState(90);
  const { data, error } = usePolling<{ windowDays: number; gaps: Gap[] }>(
    () => api.get<{ windowDays: number; gaps: Gap[] }>(`/metrics/coverage-gaps?days=${days}`).then((r) => r.data),
    0, [days],
  );

  return (
    <Shell
      title="커버리지 부족"
      subtitle="자산이 없어 반려된 오더의 속성 조합입니다. 반복되는 조합이 곧 다음 촬영에서 확보해야 할 목록입니다."
    >
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        {[30, 90, 180, 365].map((d) => (
          <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>{d}일</button>
        ))}
      </div>

      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div>
          : data.gaps.length === 0 ? (
            <div className="empty">
              자산 부족으로 반려된 오더가 없습니다.<br />
              <span className="sub">라이브러리가 현재 오더 조건을 충분히 덮고 있다는 뜻입니다.</span>
            </div>
          ) : (
          <table>
            <thead>
              <tr><th className="num">횟수</th><th>아티스트</th><th>요청 조합</th>
                <th>반려 사유</th><th className="num">최고 적합도</th><th>마지막</th></tr>
            </thead>
            <tbody>
              {data.gaps.map((g, i) => (
                <tr key={i}>
                  <td className="num"><strong style={{ color: g.gap_count > 2 ? 'var(--warn)' : undefined }}>{g.gap_count}</strong></td>
                  <td>{g.artist_name}</td>
                  <td>
                    <div className="row">
                      {Object.entries(g.requested_attributes ?? {}).map(([k, v]) => (
                        <span key={k} className="badge">{k}: {(v as string[]).join('/')}</span>
                      ))}
                      {Object.keys(g.requested_attributes ?? {}).length === 0 && <span className="sub">(조건 없음)</span>}
                    </div>
                  </td>
                  <td className="sub">{REASON_KO[g.reason] ?? g.reason}</td>
                  <td className="num sub">{g.best_fit_score != null ? Number(g.best_fit_score).toFixed(1) : '—'}</td>
                  <td className="sub">{relTime(g.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>이 화면을 읽는 법</h3>
        <p className="sub" style={{ margin: 0 }}>
          「최고 적합도」가 기준선(45)에 가까우면 조건을 조금만 완화해도 실행됩니다.
          크게 낮으면 그 조합의 자산이 라이브러리에 아예 없다는 뜻이므로 촬영이 필요합니다.
          V2 촬영 가이드 환류가 이 데이터 위에 얹힙니다.
        </p>
      </div>
    </Shell>
  );
}
