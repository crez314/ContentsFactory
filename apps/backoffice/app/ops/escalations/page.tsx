'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, relTime, usePolling } from '@/components/ui';

interface Data {
  tasks: Array<{ id: string; kind: string; state: string; retryCount: number; maxRetry: number;
    orderId: string | null; contentId: string | null; updatedAt: string;
    error: { code?: string; message?: string } | null }>;
  blockedContents: Array<{ id: string; status: string; title: string | null; orderId: string; updatedAt: string }>;
  qcResults: Array<{ contentId: string; attempt: number; verdict: string; totalScore: number;
    violations: Array<{ area: string; code: string; message: string }> }>;
}

export default function EscalationsPage() {
  const { data, error } = usePolling<Data>(
    () => api.get<Data>('/dashboard/escalations').then((r) => r.data), 8000,
  );

  return (
    <Shell title="실패 · 에스컬레이션" subtitle="재시도가 소진되었거나 정책·저작권 위반으로 차단된 항목입니다.">
      <ErrorBox error={error} />
      {!data ? <div className="empty">불러오는 중…</div> : (
        <>
          <h2>Task ({data.tasks.length})</h2>
          <div className="card">
            {data.tasks.length === 0 ? <div className="empty">문제가 있는 Task 가 없습니다.</div> : (
              <table>
                <thead><tr><th>Task</th><th>종류</th><th>상태</th><th>재시도</th><th>대상</th><th>오류</th><th>갱신</th></tr></thead>
                <tbody>
                  {data.tasks.map((t) => (
                    <tr key={t.id}>
                      <td><Link href={`/ops/tasks?taskId=${t.id}`} className="mono">{t.id.slice(0, 8)}</Link></td>
                      <td><span className="badge">{t.kind}</span></td>
                      <td><StatusBadge status={t.state} /></td>
                      <td className="sub">{t.retryCount} / {t.maxRetry}</td>
                      <td className="sub mono">
                        {t.contentId ? <Link href={`/contents/${t.contentId}`}>C:{t.contentId.slice(0, 6)}</Link>
                          : t.orderId ? <Link href={`/orders/${t.orderId}`}>O:{t.orderId.slice(0, 6)}</Link> : '-'}
                      </td>
                      <td className="sub">{t.error?.code} {t.error?.message?.slice(0, 70)}</td>
                      <td className="sub">{relTime(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2>차단·QC 실패 콘텐츠 ({data.blockedContents.length})</h2>
          <div className="card">
            {data.blockedContents.length === 0 ? <div className="empty">차단된 콘텐츠가 없습니다.</div> : (
              <table>
                <thead><tr><th>콘텐츠</th><th>제목</th><th>상태</th><th>위반</th><th>갱신</th></tr></thead>
                <tbody>
                  {data.blockedContents.map((c) => {
                    const qc = data.qcResults
                      .filter((q) => q.contentId === c.id)
                      .sort((a, b) => b.attempt - a.attempt)[0];
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/contents/${c.id}`} className="mono">{c.id.slice(0, 8)}</Link></td>
                        <td>{c.title ?? '-'}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td className="sub">
                          {qc?.violations?.length
                            ? qc.violations.map((v) => `${v.area}/${v.code}`).join(', ')
                            : qc ? `${qc.verdict} ${qc.totalScore.toFixed(1)}` : '-'}
                        </td>
                        <td className="sub">{relTime(c.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
