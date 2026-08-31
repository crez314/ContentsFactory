'use client';

import { useEffect, useState } from 'react';
import { api, API_BASE, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, relTime, usePolling } from '@/components/ui';

interface Asset {
  id: string; storageKey: string; mediaType: string; qualityGrade: string; taggingStatus: string;
  status: string; attributes: Record<string, string>; shotAt: string | null; createdAt: string;
  licenses?: Array<{ allowedChannels: string[]; allowedRegions: string[]; derivativeAllowed: boolean; validUntil: string }>;
}
interface MasterAttrs { labels: Record<string, string>; attributes: Record<string, Array<{ id: string; value: string }>> }
interface Artist { id: string; name: string; code: string }

export default function AssetsPage() {
  const me = tokens.user;
  const [master, setMaster] = useState<MasterAttrs | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [grade, setGrade] = useState('');
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<unknown>(null);

  useEffect(() => {
    void api.get<MasterAttrs>('/master/attributes').then((r) => setMaster(r.data));
    void api.get<Artist[]>('/artists').then((r) => setArtists(r.data));
  }, []);

  const qs = [
    'limit=48',
    grade ? `qualityGrade=${grade}` : '',
    ...Object.entries(filters).filter(([, v]) => v.length).map(([k, v]) => `attr.${k}=${v.join(',')}`),
  ].filter(Boolean).join('&');

  const { data, error, reload } = usePolling<Asset[]>(
    () => api.get<Asset[]>(`/assets?${qs}`).then((r) => r.data), 0, [qs],
  );

  /** §4.1 업로드 — Presigned URL 발급 → 직접 업로드 → 완료 콜백 */
  const upload = async (file: File, artistId: string) => {
    setUploadErr(null); setUploadMsg('업로드 URL 발급 중…');
    try {
      const { data: issued } = await api.post<{ assetId: string; uploadUrl: string }>('/assets/upload-url', {
        artistId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        mediaType: file.type.startsWith('video') ? 'VIDEO' : file.type.startsWith('audio') ? 'AUDIO' : 'PHOTO',
      });
      setUploadMsg('스토리지 업로드 중…');
      const put = await fetch(issued.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) throw new Error(`업로드 실패 (${put.status})`);
      setUploadMsg('완료 처리 중…');
      await api.post(`/assets/${issued.assetId}/complete`, {});
      setUploadMsg('업로드 완료 — 자동 태깅 큐에 넣었습니다.');
      await reload();
    } catch (e) {
      setUploadErr(e); setUploadMsg(null);
    }
  };

  return (
    <Shell title="자산 목록 · 업로드" subtitle={`API ${API_BASE}`}>
      <ErrorBox error={error} />
      <ErrorBox error={uploadErr} />

      {hasMinRole(me?.role, 'OPERATOR') && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>업로드</h3>
          <div className="row">
            <select id="artist-select" style={{ maxWidth: 260 }}>
              {artists.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </select>
            <input type="file" accept="image/*,video/*,audio/*" style={{ maxWidth: 320 }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                const sel = document.getElementById('artist-select') as HTMLSelectElement | null;
                if (f && sel?.value) void upload(f, sel.value);
              }} />
            {uploadMsg && <span className="badge info">{uploadMsg}</span>}
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            Presigned URL 로 스토리지에 직접 올린 뒤 완료 콜백에서 실제 업로드를 확인합니다.
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>필터</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="sub" style={{ width: 60 }}>품질</span>
          {['', 'A', 'B', 'C'].map((g) => (
            <button key={g || 'all'} className={grade === g ? 'primary' : ''} style={{ padding: '4px 9px' }}
              onClick={() => setGrade(g)}>{g || '전체'}</button>
          ))}
        </div>
        {master && Object.entries(master.attributes).map(([attr, values]) => (
          <div className="row" key={attr} style={{ marginBottom: 6 }}>
            <span className="sub" style={{ width: 60 }}>{master.labels[attr] ?? attr}</span>
            {values.map((v) => {
              const on = (filters[attr] ?? []).includes(v.value);
              return (
                <button key={v.id} className={on ? 'primary' : ''} style={{ padding: '4px 9px', fontSize: 12 }}
                  onClick={() => {
                    const cur = filters[attr] ?? [];
                    setFilters({ ...filters, [attr]: on ? cur.filter((x) => x !== v.value) : [...cur, v.value] });
                  }}>{v.value}</button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="card">
        {!data ? <div className="empty">불러오는 중…</div>
          : data.length === 0 ? <div className="empty">조건에 맞는 자산이 없습니다.</div> : (
          <table>
            <thead>
              <tr><th>자산</th><th>속성</th><th>등급</th><th>태깅</th><th>상태</th>
                <th>라이선스</th><th>촬영</th><th>등록</th></tr>
            </thead>
            <tbody>
              {data.map((a) => {
                const lic = a.licenses?.[0];
                return (
                  <tr key={a.id}>
                    <td className="mono">{a.id.slice(0, 8)}</td>
                    <td className="sub mono">{Object.entries(a.attributes).map(([k, v]) => `${k}:${v}`).join(' ')}</td>
                    <td><span className="badge">{a.qualityGrade}</span></td>
                    <td><span className={`badge ${a.taggingStatus === 'REVIEWED' ? 'ok' : a.taggingStatus === 'PENDING' ? 'warn' : ''}`}>{a.taggingStatus}</span></td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="sub">
                      {lic ? `${lic.allowedRegions.join('/')} · ~${lic.validUntil}${lic.derivativeAllowed ? '' : ' · 2차가공 불가'}` : '없음'}
                    </td>
                    <td className="sub">{a.shotAt ?? '-'}</td>
                    <td className="sub">{relTime(a.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
