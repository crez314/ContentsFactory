'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, tokens, canReview } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, usePolling } from '@/components/ui';

interface QueueItem {
  id: string; title: string | null; outputType: string; thumbnailUrl: string | null; updatedAt: string;
  qc: { totalScore: number; verdict: string; areaScores: Record<string, number>; violations: unknown[] } | null;
  order?: { orderNo: string; requestedBy: string; artist?: { name: string } | null } | null;
}

export default function ApprovalQueuePage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const me = tokens.user;
  const { data, error, reload } = usePolling<QueueItem[]>(
    () => api.get<QueueItem[]>('/contents/approval-queue?limit=60').then((r) => r.data), 8000,
  );

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id); setActionError(null);
    try {
      await api.post(`/contents/${id}/${decision}`, { comment: decision === 'reject' ? '백오피스에서 반려' : undefined });
      await reload();
    } catch (e) { setActionError(e); } finally { setBusy(null); }
  };

  const reviewer = canReview(me?.role);

  return (
    <Shell title="승인 대기열" subtitle={reviewer ? '승인·반려는 REVIEWER 이상만 가능하며, 본인이 만든 오더는 승인할 수 없습니다 (4-eyes).' : '조회 전용 — 승인 권한이 없습니다.'}>
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      {!data ? <div className="empty">불러오는 중…</div>
        : data.length === 0 ? <div className="card"><div className="empty">승인 대기 중인 콘텐츠가 없습니다.</div></div> : (
        <div className="thumbgrid">
          {data.map((c) => {
            const selfOwned = c.order?.requestedBy === me?.id && me?.role !== 'SUPER_ROOT';
            return (
              <div className="card" key={c.id} style={{ padding: 10 }}>
                <Link href={`/contents/${c.id}`}>
                  {c.thumbnailUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="thumb" src={c.thumbnailUrl} alt="" />
                    : <div className="thumb" />}
                </Link>
                <div style={{ marginTop: 8, fontSize: 12, minHeight: 32 }}>{c.title ?? '(제목 없음)'}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="badge">{c.outputType}</span>
                  {c.qc && <span className={`badge ${c.qc.totalScore >= 90 ? 'ok' : c.qc.totalScore >= 80 ? 'info' : 'warn'}`}>
                    QC {c.qc.totalScore.toFixed(1)}
                  </span>}
                </div>
                <div className="sub mono" style={{ marginTop: 4 }}>{c.order?.orderNo}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="primary" style={{ flex: 1 }}
                    disabled={!reviewer || selfOwned || busy === c.id}
                    title={selfOwned ? '본인이 생성한 오더는 승인할 수 없습니다 (4-eyes).' : undefined}
                    onClick={() => void decide(c.id, 'approve')}>승인</button>
                  <button className="danger" disabled={!reviewer || busy === c.id}
                    onClick={() => void decide(c.id, 'reject')}>반려</button>
                </div>
                {selfOwned && <div className="sub" style={{ marginTop: 6, color: 'var(--warn)' }}>본인 오더 — 승인 불가</div>}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
