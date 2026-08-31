'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, duration, relTime, usePolling } from '@/components/ui';

interface ContentRow {
  id: string; status: string; outputType: string; title: string | null;
  durationMs: number | null; createdAt: string; thumbnailUrl: string | null;
  qc: { totalScore: number; verdict: string } | null;
  order?: { orderNo: string; artist?: { name: string } | null } | null;
}

const STATUSES = ['', 'GENERATING,RENDERING,QC', 'READY', 'APPROVED', 'PUBLISHED', 'QC_FAILED,BLOCKED,FAILED,REJECTED'];
const LABELS = ['전체', '생성 중', '승인 대기', '승인됨', '게시됨', '문제'];

export default function ContentsPage() {
  const [status, setStatus] = useState('');
  const { data, error } = usePolling<ContentRow[]>(
    () => api.get<ContentRow[]>(`/contents?limit=60${status ? `&status=${status}` : ''}`).then((r) => r.data),
    6000, [status],
  );

  return (
    <Shell title="콘텐츠 목록">
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        {STATUSES.map((s, i) => (
          <button key={s || 'all'} className={status === s ? 'primary' : ''} onClick={() => setStatus(s)}>{LABELS[i]}</button>
        ))}
      </div>
      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div>
          : data.length === 0 ? <div className="empty">콘텐츠가 없습니다.</div> : (
          <table>
            <thead>
              <tr><th style={{ width: 64 }}></th><th>콘텐츠</th><th>오더</th><th>아티스트</th>
                <th>제목</th><th>유형</th><th>길이</th><th className="num">QC</th><th>상태</th><th>생성</th></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.thumbnailUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={c.thumbnailUrl} alt="" style={{ width: 44, height: 78, objectFit: 'cover', borderRadius: 6 }} />
                      : <div style={{ width: 44, height: 78, background: 'var(--panel-2)', borderRadius: 6 }} />}
                  </td>
                  <td><Link href={`/contents/${c.id}`} className="mono">{c.id.slice(0, 8)}</Link></td>
                  <td className="sub mono">{c.order?.orderNo ?? '-'}</td>
                  <td className="sub">{c.order?.artist?.name ?? '-'}</td>
                  <td>{c.title ?? '-'}</td>
                  <td><span className="badge">{c.outputType}</span></td>
                  <td className="sub">{duration(c.durationMs)}</td>
                  <td className="num">{c.qc ? c.qc.totalScore.toFixed(1) : '-'}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="sub">{relTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
