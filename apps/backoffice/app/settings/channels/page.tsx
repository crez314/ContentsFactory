'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, usePolling } from '@/components/ui';

interface Channel {
  id: string; platform: string; handle: string; segment: string | null; region: string | null;
  status: string; credentialRef: string | null;
  spec: { aspect?: string; maxDurationSec?: number; captionLimit?: number; maxHashtags?: number; supportsPrivateUpload?: boolean };
}

export default function ChannelsPage() {
  const me = tokens.user;
  const admin = hasMinRole(me?.role, 'ADMIN');
  const [form, setForm] = useState({
    platform: 'YOUTUBE', handle: '', segment: 'F20', region: 'KR',
    aspect: '9:16', maxDurationSec: 60, captionLimit: 5000, maxHashtags: 15,
    credentialRef: '',
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const { data, error, reload } = usePolling<Channel[]>(() => api.get<Channel[]>('/channels').then((r) => r.data), 0);

  const create = async () => {
    setBusy(true); setActionError(null);
    try {
      await api.post('/channels', {
        platform: form.platform, handle: form.handle, segment: form.segment, region: form.region,
        credentialRef: form.credentialRef || undefined,
        spec: {
          aspect: form.aspect, maxDurationSec: form.maxDurationSec,
          captionLimit: form.captionLimit, maxHashtags: form.maxHashtags,
        },
      });
      setForm((f) => ({ ...f, handle: '', credentialRef: '' }));
      await reload();
    } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Shell title="채널" subtitle="채널 규격은 오더 검증(SPEC_MISMATCH)과 게시 전 변환의 기준이 됩니다.">
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />
      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div> : (
          <table>
            <thead>
              <tr><th>플랫폼</th><th>핸들</th><th>세그먼트</th><th>지역</th><th>규격</th>
                <th>자격증명</th><th>상태</th>{admin && <th></th>}</tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><span className="badge">{c.platform}</span></td>
                  <td>{c.handle}</td>
                  <td className="sub">{c.segment ?? '-'}</td>
                  <td className="sub">{c.region ?? '-'}</td>
                  <td className="sub mono">
                    {c.spec.aspect} · 최대 {c.spec.maxDurationSec}초 · 캡션 {c.spec.captionLimit} · 태그 {c.spec.maxHashtags}
                  </td>
                  <td className="sub mono">{c.credentialRef ? '설정됨' : <span className="badge danger">없음</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                  {admin && (
                    <td>
                      <button style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
                        onClick={() => void api.patch(`/channels/${c.id}`, { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }).then(reload)}>
                        {c.status === 'ACTIVE' ? '일시정지' : '활성화'}
                      </button>
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
          <h3>채널 등록</h3>
          <div className="grid cols-4">
            <div className="field"><label>플랫폼</label>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'].map((p) => <option key={p}>{p}</option>)}
              </select></div>
            <div className="field"><label>핸들</label>
              <input value={form.handle} placeholder="@crez_new" onChange={(e) => setForm({ ...form, handle: e.target.value })} /></div>
            <div className="field"><label>세그먼트</label>
              <input value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} /></div>
            <div className="field"><label>지역</label>
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
          </div>
          <div className="grid cols-4">
            <div className="field"><label>화면비</label>
              <select value={form.aspect} onChange={(e) => setForm({ ...form, aspect: e.target.value })}>
                {['9:16', '1:1', '16:9'].map((a) => <option key={a}>{a}</option>)}
              </select></div>
            <div className="field"><label>최대 길이(초)</label>
              <input type="number" value={form.maxDurationSec} onChange={(e) => setForm({ ...form, maxDurationSec: Number(e.target.value) })} /></div>
            <div className="field"><label>캡션 한도</label>
              <input type="number" value={form.captionLimit} onChange={(e) => setForm({ ...form, captionLimit: Number(e.target.value) })} /></div>
            <div className="field"><label>해시태그 한도</label>
              <input type="number" value={form.maxHashtags} onChange={(e) => setForm({ ...form, maxHashtags: Number(e.target.value) })} /></div>
          </div>
          <div className="field"><label>자격증명 참조 (Secrets Manager 경로)</label>
            <input value={form.credentialRef} placeholder="secretsmanager://crez/channels/…"
              onChange={(e) => setForm({ ...form, credentialRef: e.target.value })} /></div>
          <button className="primary" disabled={busy || !form.handle} onClick={() => void create()}>등록</button>
        </div>
      )}
    </Shell>
  );
}
