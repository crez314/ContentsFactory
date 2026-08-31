'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, usePolling } from '@/components/ui';

interface Asset { id: string; attributes: Record<string, string>; qualityGrade: string; taggingStatus: string; storageKey: string }
interface MasterAttrs { labels: Record<string, string>; attributes: Record<string, Array<{ id: string; value: string }>> }

/** §7.1 태깅 검토 대기열 — 자동 태깅 결과를 운영자가 확정한다. */
export default function TaggingQueuePage() {
  const [master, setMaster] = useState<MasterAttrs | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  useEffect(() => { void api.get<MasterAttrs>('/master/attributes').then((r) => setMaster(r.data)); }, []);

  const { data, error, reload } = usePolling<Asset[]>(
    () => api.get<Asset[]>('/assets?limit=40&taggingStatus=PENDING').then((r) => r.data), 0,
  );

  const save = async (id: string) => {
    setBusy(id); setActionError(null);
    try {
      await api.patch(`/assets/${id}/attributes`, { attributes: draft[id] ?? {}, markReviewed: true });
      await reload();
    } catch (e) { setActionError(e); } finally { setBusy(null); }
  };

  return (
    <Shell title="태깅 검토 대기열" subtitle="자동 태깅(AUTO_DONE) 결과를 확인해 REVIEWED 로 확정합니다. 표준값 외의 값은 저장되지 않습니다.">
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      {!data ? <div className="empty">불러오는 중…</div>
        : data.length === 0 ? <div className="card"><div className="empty">검토 대기 중인 자산이 없습니다.</div></div> : (
        <div className="grid cols-2">
          {data.map((a) => {
            const cur = { ...a.attributes, ...(draft[a.id] ?? {}) };
            return (
              <div className="card" key={a.id}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="mono">{a.id.slice(0, 8)}</span>
                  <span className="badge">{a.qualityGrade}</span>
                  <span className="badge warn">{a.taggingStatus}</span>
                </div>
                {master && Object.entries(master.attributes).map(([attr, values]) => (
                  <div className="field" key={attr} style={{ marginBottom: 8 }}>
                    <label>{master.labels[attr] ?? attr}</label>
                    <select value={cur[attr] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [a.id]: { ...(d[a.id] ?? {}), [attr]: e.target.value } }))}>
                      <option value="">(미지정)</option>
                      {values.map((v) => <option key={v.id} value={v.value}>{v.value}</option>)}
                    </select>
                  </div>
                ))}
                <button className="primary" disabled={busy === a.id} onClick={() => void save(a.id)}>
                  {busy === a.id ? '저장 중…' : 'REVIEWED 로 확정'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
