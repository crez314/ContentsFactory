'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, usePolling } from '@/components/ui';

interface MasterAttrs { labels: Record<string, string>; attributes: Record<string, Array<{ id: string; value: string; labelKo: string | null }>> }
interface BannedTerm { id: string; term: string; category: string; severity: string; note: string | null }

export default function MasterPage() {
  const me = tokens.user;
  const admin = hasMinRole(me?.role, 'ADMIN');
  const [tab, setTab] = useState<'attrs' | 'terms'>('attrs');
  const [newAttr, setNewAttr] = useState({ attribute: 'angle', value: '', labelKo: '' });
  const [newTerm, setNewTerm] = useState({ term: '', category: 'BRAND', severity: 'WARN' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const attrs = usePolling<MasterAttrs>(() => api.get<MasterAttrs>('/master/attributes').then((r) => r.data), 0);
  const terms = usePolling<BannedTerm[]>(() => api.get<BannedTerm[]>('/master/banned-terms').then((r) => r.data), 0);

  const run = async (fn: () => Promise<unknown>, reload: () => Promise<void>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await reload(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Shell title="마스터" subtitle="자산 속성 표준값과 금지어 사전. 자유 입력을 막아 매칭 가능성을 보장합니다.">
      <ErrorBox error={attrs.error} />
      <ErrorBox error={terms.error} />
      <ErrorBox error={actionError} />

      <div className="tabs">
        <button className={tab === 'attrs' ? 'active' : ''} onClick={() => setTab('attrs')}>속성 표준값</button>
        <button className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}>금지어</button>
      </div>

      {tab === 'attrs' && (
        <>
          <div className="card">
            {!attrs.data ? <div className="empty">불러오는 중…</div> :
              Object.entries(attrs.data.attributes).map(([attr, values]) => (
                <div key={attr} style={{ marginBottom: 14 }}>
                  <h3>{attrs.data!.labels[attr] ?? attr} <span className="sub mono">({attr})</span></h3>
                  <div className="row">
                    {values.map((v) => (
                      <span key={v.id} className="badge">
                        {v.value}
                        {admin && (
                          <button style={{ marginLeft: 6, padding: 0, border: 'none', background: 'none', color: 'var(--danger)' }}
                            disabled={busy}
                            onClick={() => void run(() => api.del(`/master/attributes/${v.id}`), attrs.reload)}>×</button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
          {admin && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>표준값 추가</h3>
              <div className="grid cols-4">
                <div className="field"><label>속성</label>
                  <select value={newAttr.attribute} onChange={(e) => setNewAttr({ ...newAttr, attribute: e.target.value })}>
                    {Object.keys(attrs.data?.attributes ?? {}).map((a) => <option key={a}>{a}</option>)}
                  </select></div>
                <div className="field"><label>값 (영문 소문자·언더스코어)</label>
                  <input value={newAttr.value} onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })} /></div>
                <div className="field"><label>한글 라벨</label>
                  <input value={newAttr.labelKo} onChange={(e) => setNewAttr({ ...newAttr, labelKo: e.target.value })} /></div>
                <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button className="primary" disabled={busy || !newAttr.value}
                    onClick={() => void run(() => api.post('/master/attributes', newAttr), attrs.reload)}>추가</button>
                </div>
              </div>
              <div className="sub">
                기존 자산이 쓰고 있을 수 있으므로 삭제는 물리 삭제가 아니라 비활성화입니다.
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'terms' && (
        <>
          <div className="card">
            {!terms.data ? <div className="empty">불러오는 중…</div> : (
              <table>
                <thead><tr><th>용어</th><th>분류</th><th>등급</th><th>효과</th>{admin && <th></th>}</tr></thead>
                <tbody>
                  {terms.data.map((t) => (
                    <tr key={t.id}>
                      <td>{t.term}</td>
                      <td><span className="badge">{t.category}</span></td>
                      <td><span className={`badge ${t.severity === 'BLOCK' ? 'danger' : 'warn'}`}>{t.severity}</span></td>
                      <td className="sub">
                        {t.severity === 'BLOCK'
                          ? 'QC policy 위반 → 즉시 BLOCKED (재시도 없음)'
                          : 'QC brand 감점'}
                      </td>
                      {admin && (
                        <td>
                          <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                            onClick={() => void run(() => api.del(`/master/banned-terms/${t.id}`), terms.reload)}>삭제</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {admin && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>금지어 추가</h3>
              <div className="grid cols-4">
                <div className="field"><label>용어</label>
                  <input value={newTerm.term} onChange={(e) => setNewTerm({ ...newTerm, term: e.target.value })} /></div>
                <div className="field"><label>분류</label>
                  <select value={newTerm.category} onChange={(e) => setNewTerm({ ...newTerm, category: e.target.value })}>
                    {['BRAND', 'POLICY', 'TOPIC'].map((c) => <option key={c}>{c}</option>)}
                  </select></div>
                <div className="field"><label>등급</label>
                  <select value={newTerm.severity} onChange={(e) => setNewTerm({ ...newTerm, severity: e.target.value })}>
                    <option value="WARN">WARN (감점)</option>
                    <option value="BLOCK">BLOCK (차단)</option>
                  </select></div>
                <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button className="primary" disabled={busy || !newTerm.term}
                    onClick={() => void run(() => api.post('/master/banned-terms', newTerm), terms.reload)}>추가</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
