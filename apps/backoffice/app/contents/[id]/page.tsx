'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, canReview, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money, ScoreBar, StatusBadge, duration, relTime, usePolling } from '@/components/ui';

const AREA_LABELS: Record<string, string> = {
  quality: '품질', identity: '동일성', brand: '브랜드',
  policy: '정책', copyright: '저작권', aiRisk: 'AI 리스크',
};

interface Detail {
  id: string; status: string; outputType: string; title: string | null; description: string | null;
  hashtags: string[]; durationMs: number | null; finalKey: string | null;
  previewUrl: string | null; thumbnailUrl: string | null; costKrw: number;
  costByProvider: Record<string, number>;
  order?: { id: string; orderNo: string; requestedBy: string; artist?: { name: string } | null } | null;
  blueprint?: { channel?: { handle: string; platform: string } | null } | null;
  scenes: Array<{ id: string; seq: number; durationMs: number; sourceType: string; status: string;
    subtitle: string | null; retryCount: number; previewUrl: string | null }>;
  qc: { attempt: number; verdict: string; totalScore: number; areaScores: Record<string, number>;
    violations: Array<{ area: string; code: string; message: string }>; retryTarget: string | null } | null;
  qcHistory: Array<{ attempt: number; verdict: string; totalScore: number; createdAt: string }>;
  artifacts: Array<{ id: string; kind: string; provider: string; costKrw: number; identityScore: number | null; storageKey: string }>;
  approvals: Array<{ id: string; decision: string; auto: boolean; levelAt: number; comment: string | null;
    createdAt: string; decider?: { name: string } | null }>;
  publications: Array<{ id: string; status: string; visibility: string; externalUrl: string | null;
    channel?: { handle: string; platform: string } | null }>;
  lineage: { sourceAssetIds: string[]; items: Array<{ assetId: string; sceneId: string | null;
    usageWeight: number; attributes: Record<string, string>; qualityGrade: string | null; thumbnailUrl: string | null }> };
}

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = tokens.user;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [comment, setComment] = useState('');
  const { data, error, reload } = usePolling<Detail>(
    () => api.get<Detail>(`/contents/${id}`).then((r) => r.data), 6000, [id],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await reload(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  if (!data) return <Shell title="콘텐츠"><ErrorBox error={error} /><div className="empty">불러오는 중…</div></Shell>;

  const reviewer = canReview(me?.role);
  const selfOwned = data.order?.requestedBy === me?.id && me?.role !== 'SUPER_ROOT';
  const canDecide = reviewer && ['READY', 'QC_FAILED'].includes(data.status);

  return (
    <Shell
      title={data.title ?? '콘텐츠'}
      subtitle={`${data.order?.orderNo ?? ''} · ${data.order?.artist?.name ?? ''} · ${data.blueprint?.channel?.handle ?? ''}`}
      actions={<><StatusBadge status={data.status} /><Link className="btn" href={`/orders/${data.order?.id}`}>오더 보기</Link></>}
    >
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />

      <div className="grid cols-3">
        <div className="card">
          <h3>미리보기</h3>
          {data.previewUrl ? (
            data.outputType === 'VIDEO'
              ? <video className="thumb" src={data.previewUrl} controls playsInline style={{ objectFit: 'contain', background: '#000' }} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img className="thumb" src={data.previewUrl} alt="" style={{ objectFit: 'contain' }} />
          ) : <div className="thumb" />}
          <div className="sub" style={{ marginTop: 8 }}>
            {duration(data.durationMs)} · 원가 <Money krw={data.costKrw} />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {data.hashtags.map((h) => <span key={h} className="badge">{h}</span>)}
          </div>
          {data.description && <p className="sub" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{data.description}</p>}
        </div>

        <div className="card">
          <h3>QC 결과 {data.qc && `(시도 ${data.qc.attempt})`}</h3>
          {!data.qc ? <div className="empty">아직 검수되지 않았습니다.</div> : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <StatusBadge status={data.qc.verdict} />
                <strong style={{ fontSize: 20 }}>{data.qc.totalScore.toFixed(2)}</strong>
                {data.qc.retryTarget && <span className="badge warn">재시도 대상 {AREA_LABELS[data.qc.retryTarget]}</span>}
              </div>
              {Object.entries(data.qc.areaScores).map(([area, score]) => (
                <ScoreBar key={area} label={AREA_LABELS[area] ?? area} score={score} />
              ))}
              {data.qc.violations.length > 0 && (
                <>
                  <h3 style={{ marginTop: 12 }}>위반 항목</h3>
                  {data.qc.violations.map((v, i) => (
                    <div key={i} className="row" style={{ marginBottom: 4 }}>
                      <span className="badge danger">{AREA_LABELS[v.area] ?? v.area}</span>
                      <span className="sub">{v.code} — {v.message}</span>
                    </div>
                  ))}
                </>
              )}
              {data.qcHistory.length > 1 && (
                <div className="sub" style={{ marginTop: 10 }}>
                  이력: {data.qcHistory.map((h) => `#${h.attempt} ${h.verdict} ${h.totalScore.toFixed(1)}`).join(' → ')}
                </div>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h3>액션</h3>
          <div className="field">
            <label>코멘트</label>
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="row">
            <button className="primary" disabled={!canDecide || selfOwned || busy}
              title={selfOwned ? '본인이 생성한 오더는 승인할 수 없습니다 (4-eyes).' : undefined}
              onClick={() => void act(() => api.post(`/contents/${id}/approve`, { comment: comment || undefined }))}>
              승인
            </button>
            <button className="danger" disabled={!canDecide || busy}
              onClick={() => void act(() => api.post(`/contents/${id}/reject`, { comment: comment || undefined }))}>
              반려
            </button>
          </div>
          <h3 style={{ marginTop: 14 }}>부분 재생성</h3>
          <div className="row">
            {['quality', 'identity', 'brand', 'aiRisk'].map((t) => (
              <button key={t} disabled={busy}
                onClick={() => void act(() => api.post(`/contents/${id}/regenerate`, { target: t }))}>
                {AREA_LABELS[t]}
              </button>
            ))}
          </div>

          <h3 style={{ marginTop: 14 }}>게시</h3>
          {data.publications.length === 0 ? <div className="sub">게시 기록이 없습니다.</div> : data.publications.map((p) => (
            <div key={p.id} style={{ marginBottom: 8 }}>
              <div className="row">
                <span className="badge">{p.channel?.platform}</span>
                <span className="sub">{p.channel?.handle}</span>
                <StatusBadge status={p.status} />
                <span className={`badge ${p.visibility === 'PUBLIC' ? 'ok' : 'warn'}`}>{p.visibility}</span>
              </div>
              {p.externalUrl && <a className="sub mono" href={p.externalUrl} target="_blank" rel="noreferrer">{p.externalUrl}</a>}
              {p.visibility !== 'PUBLIC' && ['UPLOADED', 'PUBLISHED'].includes(p.status) && (
                <button className="primary" style={{ marginTop: 6 }} disabled={!reviewer || busy}
                  onClick={() => void act(() => api.post(`/publications/${p.id}/publicize`, { visibility: 'PUBLIC' }))}>
                  공개 전환
                </button>
              )}
            </div>
          ))}

          <h3 style={{ marginTop: 14 }}>승인 이력</h3>
          {data.approvals.length === 0 ? <div className="sub">없음</div> : data.approvals.map((a) => (
            <div key={a.id} className="row" style={{ marginBottom: 4 }}>
              <StatusBadge status={a.decision} />
              <span className="badge">{a.auto ? '자동' : a.decider?.name ?? '수동'}</span>
              <span className="sub">L{a.levelAt} · {relTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>

      {data.scenes.length > 0 && (
        <>
          <h2>Scene ({data.scenes.length})</h2>
          <div className="thumbgrid">
            {data.scenes.map((s) => (
              <div className="card" key={s.id} style={{ padding: 10 }}>
                {s.previewUrl
                  ? (s.previewUrl.includes('.mp4')
                      ? <video className="thumb" src={s.previewUrl} controls playsInline style={{ objectFit: 'cover' }} />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img className="thumb" src={s.previewUrl} alt="" />)
                  : <div className="thumb" />}
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="badge">#{s.seq}</span>
                  <span className="badge">{s.sourceType}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="sub" style={{ marginTop: 4 }}>{duration(s.durationMs)} · 재시도 {s.retryCount}</div>
                {s.subtitle && <div className="sub" style={{ marginTop: 4 }}>{s.subtitle}</div>}
                <button style={{ marginTop: 6, width: '100%' }} disabled={busy}
                  onClick={() => void act(() => api.post(`/contents/${id}/regenerate`, { sceneId: s.id }))}>
                  이 Scene 재생성
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>콘텐츠 계보 — 사용된 원본 자산 {data.lineage.sourceAssetIds.length}건</h3>
          <div className="thumbgrid">
            {data.lineage.items.map((l, i) => (
              <div key={`${l.assetId}-${i}`}>
                {l.thumbnailUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="thumb" src={l.thumbnailUrl} alt="" />
                  : <div className="thumb" />}
                <div className="sub mono" style={{ marginTop: 4, fontSize: 10 }}>
                  {Object.entries(l.attributes).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ')}
                </div>
                <div className="row" style={{ marginTop: 2 }}>
                  <span className="badge">{l.qualityGrade}</span>
                  {l.sceneId && <span className="badge info">Scene</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>원가 내역 (어댑터별)</h3>
          <table>
            <thead><tr><th>어댑터</th><th className="num">비용</th></tr></thead>
            <tbody>
              {Object.entries(data.costByProvider).map(([p, v]) => (
                <tr key={p}><td className="mono">{p}</td><td className="num"><Money krw={v} /></td></tr>
              ))}
              <tr><th>합계</th><td className="num"><strong><Money krw={data.costKrw} /></strong></td></tr>
            </tbody>
          </table>

          <h3 style={{ marginTop: 14 }}>생성 산출물</h3>
          <table>
            <thead><tr><th>종류</th><th>어댑터</th><th className="num">동일성</th><th className="num">비용</th></tr></thead>
            <tbody>
              {data.artifacts.map((a) => (
                <tr key={a.id}>
                  <td><span className="badge">{a.kind}</span></td>
                  <td className="mono sub">{a.provider}</td>
                  <td className="num">{a.identityScore != null ? a.identityScore.toFixed(3) : '-'}</td>
                  <td className="num"><Money krw={a.costKrw} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
