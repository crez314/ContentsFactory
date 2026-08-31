'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Progress, StatusBadge, relTime, usePolling } from '@/components/ui';

interface OrderRow {
  id: string; orderNo: string; status: string; outputType: string; quantity: number;
  createdAt: string; budgetCap: number;
  artist?: { name: string } | null;
  requester?: { name: string } | null;
  channels?: Array<{ handle: string; platform: string }>;
  progress: { total: number; published: number; failed: number; percent: number };
}

const STATUSES = ['', 'DRAFT', 'VALIDATING', 'REJECTED', 'QUEUED', 'RUNNING', 'PARTIAL', 'DONE', 'CANCELLED'];

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const { data, error } = usePolling<OrderRow[]>(
    () => api.get<OrderRow[]>(`/orders?limit=50${status ? `&status=${status}` : ''}`).then((r) => r.data),
    6000, [status],
  );

  return (
    <Shell title="오더 목록" actions={<Link className="btn" href="/orders/new">오더 생성</Link>}>
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        {STATUSES.map((s) => (
          <button key={s || 'all'} className={status === s ? 'primary' : ''} onClick={() => setStatus(s)}>
            {s || '전체'}
          </button>
        ))}
      </div>
      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div>
          : data.length === 0 ? <div className="empty">오더가 없습니다.</div> : (
          <table>
            <thead>
              <tr>
                <th>오더번호</th><th>아티스트</th><th>채널</th><th>산출물</th>
                <th className="num">수량</th><th>상태</th><th style={{ width: 180 }}>진행률</th><th>요청자</th><th>생성</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/orders/${o.id}`} className="mono">{o.orderNo}</Link></td>
                  <td>{o.artist?.name ?? '-'}</td>
                  <td className="sub">{(o.channels ?? []).map((c) => c.handle).join(', ') || '-'}</td>
                  <td><span className="badge">{o.outputType}</span></td>
                  <td className="num">{o.quantity}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>
                    <Progress percent={o.progress.percent} />
                    <div className="sub" style={{ marginTop: 3 }}>
                      게시 {o.progress.published} / {o.progress.total}
                      {o.progress.failed > 0 && ` · 실패 ${o.progress.failed}`}
                    </div>
                  </td>
                  <td className="sub">{o.requester?.name ?? '-'}</td>
                  <td className="sub">{relTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
