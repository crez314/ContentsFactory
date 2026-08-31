'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, duration, relTime, usePolling } from '@/components/ui';

interface Task {
  id: string; kind: string; state: string; priority: number; retryCount: number; maxRetry: number;
  orderId: string | null; contentId: string | null; sceneId: string | null;
  queuedAt: string; startedAt: string | null; finishedAt: string | null; elapsedMs: number;
  error: { code?: string; message?: string } | null;
}
interface TaskDetail extends Task {
  events: Array<{ id: string; fromState: string | null; toState: string; reason: string | null; createdAt: string }>;
  payload: Record<string, unknown>;
}

const STATES = ['', 'QUEUED', 'RUNNING', 'RETRY', 'FALLBACK', 'ESCALATED', 'DONE', 'FAILED', 'CANCELLED'];
const KINDS = ['', 'SELECTION', 'BLUEPRINT', 'GENERATE_IMAGE', 'GENERATE_VIDEO', 'RENDER', 'QC', 'PUBLISH'];

function TaskMonitor() {
  const params = useSearchParams();
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<string | null>(params.get('taskId'));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const qs = ['limit=60', state ? `state=${state}` : '', kind ? `kind=${kind}` : ''].filter(Boolean).join('&');
  const { data, error, reload } = usePolling<Task[]>(
    () => api.get<Task[]>(`/tasks?${qs}`).then((r) => r.data), 4000, [qs],
  );
  const { data: detail, reload: reloadDetail } = usePolling<TaskDetail | null>(
    () => (selected ? api.get<TaskDetail>(`/tasks/${selected}`).then((r) => r.data) : Promise.resolve(null)),
    4000, [selected],
  );

  const act = async (id: string, what: 'retry' | 'cancel') => {
    setBusy(true); setActionError(null);
    try { await api.post(`/tasks/${id}/${what}`, {}); await reload(); await reloadDetail(); }
    catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Shell title="Task 모니터" subtitle="4초마다 갱신됩니다.">
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      <div className="row" style={{ marginBottom: 10 }}>
        {STATES.map((s) => (
          <button key={s || 'all'} className={state === s ? 'primary' : ''} style={{ padding: '4px 9px', fontSize: 12 }}
            onClick={() => setState(s)}>{s || '전체 상태'}</button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        {KINDS.map((k) => (
          <button key={k || 'all'} className={kind === k ? 'primary' : ''} style={{ padding: '4px 9px', fontSize: 12 }}
            onClick={() => setKind(k)}>{k || '전체 종류'}</button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: selected ? '1fr 420px' : '1fr' }}>
        <div className="card">
          {!data ? <div className="empty">불러오는 중…</div>
            : data.length === 0 ? <div className="empty">Task 가 없습니다.</div> : (
            <table>
              <thead>
                <tr><th>Task</th><th>종류</th><th className="num">P</th><th>상태</th><th>대상</th>
                  <th>재시도</th><th>소요</th><th>큐 투입</th><th></th></tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(t.id)}>
                    <td className="mono">{t.id.slice(0, 8)}</td>
                    <td><span className="badge">{t.kind}</span></td>
                    <td className="num">{t.priority}</td>
                    <td><StatusBadge status={t.state} /></td>
                    <td className="sub mono">
                      {t.orderId && <Link href={`/orders/${t.orderId}`}>O:{t.orderId.slice(0, 6)}</Link>}
                      {t.contentId && <> <Link href={`/contents/${t.contentId}`}>C:{t.contentId.slice(0, 6)}</Link></>}
                      {t.sceneId && <> S:{t.sceneId.slice(0, 6)}</>}
                    </td>
                    <td className={t.retryCount > 0 ? 'sub' : 'sub'} style={t.retryCount >= t.maxRetry ? { color: 'var(--danger)' } : undefined}>
                      {t.retryCount} / {t.maxRetry}
                    </td>
                    <td className="sub">{duration(t.elapsedMs)}</td>
                    <td className="sub">{relTime(t.queuedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row">
                        {['ESCALATED', 'FAILED', 'RETRY', 'FALLBACK'].includes(t.state) && (
                          <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                            onClick={() => void act(t.id, 'retry')}>재시도</button>
                        )}
                        {['QUEUED', 'RETRY', 'FALLBACK', 'RUNNING'].includes(t.state) && (
                          <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                            onClick={() => void act(t.id, 'cancel')}>취소</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: 20 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>이벤트 이력</h3>
              <div className="spacer" />
              <button style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => setSelected(null)}>닫기</button>
            </div>
            {!detail ? <div className="empty">불러오는 중…</div> : (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="badge">{detail.kind}</span>
                  <StatusBadge status={detail.state} />
                  <span className="sub">{duration(detail.elapsedMs)}</span>
                </div>
                <table>
                  <tbody>
                    {detail.events.map((e) => (
                      <tr key={e.id}>
                        <td className="sub" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(e.createdAt).toLocaleTimeString('ko-KR')}
                        </td>
                        <td className="sub">{e.fromState ?? '—'} → <strong>{e.toState}</strong></td>
                        <td className="sub">{e.reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.error && (
                  <>
                    <h3 style={{ marginTop: 12 }}>오류</h3>
                    <pre>{JSON.stringify(detail.error, null, 2)}</pre>
                  </>
                )}
                <h3 style={{ marginTop: 12 }}>Payload</h3>
                <pre>{JSON.stringify(detail.payload, null, 2)}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function TasksPage() {
  return <Suspense fallback={null}><TaskMonitor /></Suspense>;
}
