'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, usePolling } from '@/components/ui';

interface Asset {
  id: string; attributes: Record<string, string>; qualityGrade: string;
  licenses?: Array<{ id: string; allowedChannels: string[]; allowedRegions: string[];
    derivativeAllowed: boolean; validFrom: string; validUntil: string; contractRef: string | null }>;
}

const CHANNELS = ['youtube', 'instagram', 'tiktok', 'x'];
const REGIONS = ['KR', 'JP', 'US', 'GLOBAL'];

export default function LicensesPage() {
  const me = tokens.user;
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    allowedChannels: CHANNELS, allowedRegions: ['KR'], derivativeAllowed: true,
    validFrom: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    contractRef: '',
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const { data, error, reload } = usePolling<Asset[]>(
    () => api.get<Asset[]>('/assets?limit=60').then((r) => r.data), 0,
  );

  const save = async (assetId: string) => {
    setBusy(true); setActionError(null);
    try {
      await api.post(`/assets/${assetId}/license`, { ...form, contractRef: form.contractRef || undefined });
      setEditing(null);
      await reload();
    } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  const admin = hasMinRole(me?.role, 'ADMIN');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Shell title="라이선스 관리" subtitle={admin ? '채널·지역·기간·2차가공 허용 범위를 등록합니다. 변경은 전건 감사 로그에 남습니다.' : '조회 전용 — 라이선스 변경은 ADMIN 이상만 가능합니다.'}>
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div> : (
          <table>
            <thead>
              <tr><th>자산</th><th>속성</th><th>허용 채널</th><th>허용 지역</th>
                <th>2차가공</th><th>유효기간</th><th>계약</th>{admin && <th></th>}</tr>
            </thead>
            <tbody>
              {data.map((a) => {
                const l = a.licenses?.[0];
                const expiring = l && l.validUntil < new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
                const expired = l && l.validUntil < today;
                return (
                  <tr key={a.id}>
                    <td className="mono">{a.id.slice(0, 8)}</td>
                    <td className="sub mono">{Object.entries(a.attributes).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ')}</td>
                    <td className="sub">{l?.allowedChannels.join(', ') ?? '-'}</td>
                    <td className="sub">{l?.allowedRegions.join(', ') ?? '-'}</td>
                    <td>{l ? <span className={`badge ${l.derivativeAllowed ? 'ok' : 'danger'}`}>{l.derivativeAllowed ? '허용' : '불허'}</span> : '-'}</td>
                    <td className={expired ? 'sub' : ''}>
                      {l ? (
                        <span className={`badge ${expired ? 'danger' : expiring ? 'warn' : ''}`}>
                          {l.validFrom} ~ {l.validUntil}
                        </span>
                      ) : <span className="badge danger">없음</span>}
                    </td>
                    <td className="sub mono">{l?.contractRef ?? '-'}</td>
                    {admin && (
                      <td>
                        <button style={{ padding: '3px 8px', fontSize: 12 }}
                          onClick={() => { setEditing(editing === a.id ? null : a.id); if (l) setForm({ ...l, contractRef: l.contractRef ?? '' }); }}>
                          {editing === a.id ? '닫기' : '편집'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && admin && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>라이선스 등록 · 갱신 — {editing.slice(0, 8)}</h3>
          <div className="field">
            <label>허용 채널</label>
            <div className="row">
              {CHANNELS.map((c) => (
                <button key={c} className={form.allowedChannels.includes(c) ? 'primary' : ''}
                  onClick={() => setForm((f) => ({ ...f, allowedChannels: f.allowedChannels.includes(c) ? f.allowedChannels.filter((x) => x !== c) : [...f.allowedChannels, c] }))}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>허용 지역</label>
            <div className="row">
              {REGIONS.map((r) => (
                <button key={r} className={form.allowedRegions.includes(r) ? 'primary' : ''}
                  onClick={() => setForm((f) => ({ ...f, allowedRegions: f.allowedRegions.includes(r) ? f.allowedRegions.filter((x) => x !== r) : [...f.allowedRegions, r] }))}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="grid cols-4">
            <div className="field"><label>시작일</label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} /></div>
            <div className="field"><label>만료일</label>
              <input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} /></div>
            <div className="field"><label>2차 가공</label>
              <select value={String(form.derivativeAllowed)} onChange={(e) => setForm((f) => ({ ...f, derivativeAllowed: e.target.value === 'true' }))}>
                <option value="true">허용</option><option value="false">불허</option>
              </select></div>
            <div className="field"><label>계약 참조</label>
              <input value={form.contractRef} onChange={(e) => setForm((f) => ({ ...f, contractRef: e.target.value }))} /></div>
          </div>
          <button className="primary" disabled={busy} onClick={() => void save(editing)}>저장</button>
        </div>
      )}
    </Shell>
  );
}
