'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, Money } from '@/components/ui';

interface Artist { id: string; name: string; code: string; status: string }
interface Channel { id: string; platform: string; handle: string; region: string | null; spec: Record<string, unknown> }
interface Agent { id: string; name: string; kind: string; approvalLevel: number; dailyBudget: number; lifecycle: string }
interface MasterAttrs { labels: Record<string, string>; attributes: Record<string, Array<{ id: string; value: string; labelKo: string | null }>> }
interface Preview { total: number; byChannel: Array<{ channelId: string; usable: number }>; sample: string[] }

const STEPS = ['대상', '산출물', '컨셉·디자인', '사양', '자산 조건', '운영', '검토'];

export default function NewOrderPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [artists, setArtists] = useState<Artist[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [master, setMaster] = useState<MasterAttrs | null>(null);

  const [artistId, setArtistId] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [agentId, setAgentId] = useState('');
  const [outputType, setOutputType] = useState<'IMAGE' | 'VIDEO' | 'BOTH'>('VIDEO');
  const [quantity, setQuantity] = useState(2);
  const [campaign, setCampaign] = useState('2026SS');
  const [mood, setMood] = useState('bright');
  const [story, setStory] = useState('airport_fashion');
  const [tone, setTone] = useState('warm');
  const [palette, setPalette] = useState('#F2E7D5,#2B2B2B');
  const [template, setTemplate] = useState('crez_basic_v1');
  const [aspect, setAspect] = useState('9:16');
  const [durationSec, setDurationSec] = useState(12);
  const [resolution, setResolution] = useState('1080x1920');
  const [include, setInclude] = useState<Record<string, string[]>>({ outfit: ['casual'] });
  const [exclude, setExclude] = useState<Record<string, string[]>>({ angle: ['back'] });
  const [scheduledAt, setScheduledAt] = useState('');
  const [budgetCapKrw, setBudgetCapKrw] = useState(300000);
  const [approvalLevel, setApprovalLevel] = useState(1);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [validation, setValidation] = useState<{ ok: boolean; errors: Array<{ code: string; detail: unknown }>; estimatedCostKrw: number; candidateCount: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [a, c, g, m] = await Promise.all([
        api.get<Artist[]>('/artists'),
        api.get<Channel[]>('/channels'),
        api.get<Agent[]>('/agents'),
        api.get<MasterAttrs>('/master/attributes'),
      ]);
      setArtists(a.data);
      setChannels(c.data);
      setAgents(g.data);
      setMaster(m.data);
      if (a.data[0]) setArtistId(a.data[0].id);
    })().catch(setError);
  }, []);

  /**
   * §7.2 5단계의 핵심 — 조건을 좁힐 때마다 매칭 자산 수가 즉시 갱신되어야
   * 운영자가 제출 전에 조건을 조정할 수 있다.
   */
  useEffect(() => {
    if (!artistId) return;
    const t = setTimeout(() => {
      void api.post<Preview>('/orders/preview-candidates', {
        artistId, channelIds,
        assetFilter: { include: prune(include), exclude: prune(exclude) },
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }).then((r) => setPreview(r.data)).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [artistId, channelIds, include, exclude, scheduledAt]);

  // 채널을 고르면 사양 기본값을 채운다.
  useEffect(() => {
    const first = channels.find((c) => c.id === channelIds[0]);
    if (!first) return;
    const spec = first.spec as { aspect?: string; maxDurationSec?: number };
    if (spec.aspect) {
      setAspect(spec.aspect);
      setResolution(spec.aspect === '9:16' ? '1080x1920' : spec.aspect === '1:1' ? '1080x1080' : '1920x1080');
    }
    if (spec.maxDurationSec) setDurationSec((d) => Math.min(d, spec.maxDurationSec!));
  }, [channelIds, channels]);

  const body = useMemo(() => ({
    artistId,
    channelIds,
    agentId: agentId || undefined,
    outputType,
    quantity,
    concept: { campaign, mood, story },
    design: { tone, palette: palette.split(',').map((s) => s.trim()).filter(Boolean), template },
    spec: { aspect, durationSec: outputType === 'IMAGE' ? undefined : durationSec, resolution },
    assetFilter: { include: prune(include), exclude: prune(exclude) },
    budgetCapKrw,
    approvalLevel,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  }), [artistId, channelIds, agentId, outputType, quantity, campaign, mood, story, tone, palette, template,
       aspect, durationSec, resolution, include, exclude, budgetCapKrw, approvalLevel, scheduledAt]);

  const submit = async (mode: 'draft' | 'submit') => {
    setBusy(true); setError(null);
    try {
      const created = await api.post<{ id: string }>('/orders', body, { 'Idempotency-Key': `ui-${Date.now()}` });
      if (mode === 'submit') {
        const r = await api.post<{ order: { id: string; status: string }; validation: typeof validation }>(
          `/orders/${created.data.id}/submit`, {},
        );
        setValidation(r.data.validation);
        if (r.data.order.status === 'REJECTED') { setBusy(false); return; }
      }
      router.push(`/orders/${created.data.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const canNext = step === 0 ? artistId && channelIds.length > 0 : true;

  return (
    <Shell title="오더 생성" subtitle="단계별로 입력하면 각 단계 이동 시 부분 검증을 수행합니다.">
      <ErrorBox error={error} />

      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`} onClick={() => setStep(i)}>
            {i + 1} {s}
          </button>
        ))}
      </div>

      <div className="grid cols-3">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          {step === 0 && (
            <>
              <div className="field">
                <label>아티스트</label>
                <select value={artistId} onChange={(e) => setArtistId(e.target.value)}>
                  {artists.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code}) · {a.status}</option>)}
                </select>
              </div>
              <div className="field">
                <label>대상 채널 (복수 선택)</label>
                {channels.map((c) => (
                  <label key={c.id} className="row" style={{ marginBottom: 6, cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto' }}
                      checked={channelIds.includes(c.id)}
                      onChange={(e) => setChannelIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id))} />
                    <span className="badge">{c.platform}</span>
                    <span>{c.handle}</span>
                    <span className="sub">{c.region}</span>
                    {/* 미선택 채널은 조회 대상이 아니므로 0건이 아니라 아무것도 표시하지 않는다. */}
                    {preview && channelIds.includes(c.id) && (() => {
                      const usable = preview.byChannel.find((b) => b.channelId === c.id)?.usable ?? 0;
                      return <span className={`badge ${usable > 0 ? 'ok' : 'danger'}`}>사용 가능 {usable}건</span>;
                    })()}
                  </label>
                ))}
              </div>
              <div className="field">
                <label>생성 주체 (에이전트) — 예산·승인레벨 판정 기준</label>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">(지정 안 함 — 오더의 승인 레벨 사용)</option>
                  {agents.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} · L{g.approvalLevel} · {g.dailyBudget.toLocaleString()}원/일 · {g.lifecycle}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="field">
                <label>산출물 유형</label>
                <div className="row">
                  {(['IMAGE', 'VIDEO', 'BOTH'] as const).map((t) => (
                    <button key={t} className={outputType === t ? 'primary' : ''} onClick={() => setOutputType(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>수량 (채널당) — 총 {quantity * Math.max(1, channelIds.length)}건 생성</label>
                <input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid cols-3">
                <div className="field"><label>캠페인</label><input value={campaign} onChange={(e) => setCampaign(e.target.value)} /></div>
                <div className="field"><label>무드</label>
                  <select value={mood} onChange={(e) => setMood(e.target.value)}>
                    {['bright', 'warm', 'calm', 'energetic', 'dark'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field"><label>스토리</label><input value={story} onChange={(e) => setStory(e.target.value)} /></div>
              </div>
              <div className="grid cols-3">
                <div className="field"><label>톤</label><input value={tone} onChange={(e) => setTone(e.target.value)} /></div>
                <div className="field"><label>팔레트 (쉼표 구분)</label><input value={palette} onChange={(e) => setPalette(e.target.value)} /></div>
                <div className="field"><label>템플릿</label><input value={template} onChange={(e) => setTemplate(e.target.value)} /></div>
              </div>
              <div className="row">
                {palette.split(',').map((c) => c.trim()).filter(Boolean).map((c) => (
                  <span key={c} className="badge" style={{ background: c, color: '#111', borderColor: c }}>{c}</span>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <div className="grid cols-3">
              <div className="field"><label>화면비</label>
                <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {['9:16', '1:1', '16:9'].map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field"><label>길이(초)</label>
                <input type="number" min={5} max={600} value={durationSec}
                  disabled={outputType === 'IMAGE'}
                  onChange={(e) => setDurationSec(Number(e.target.value))} />
              </div>
              <div className="field"><label>해상도</label><input value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
            </div>
          )}

          {step === 4 && master && (
            <>
              <h3>포함 조건 (선택한 값 중 하나라도 맞으면 후보)</h3>
              <AttrPicker master={master} value={include} onChange={setInclude} />
              <h3 style={{ marginTop: 16 }}>제외 조건 (하나라도 맞으면 후보에서 제거)</h3>
              <AttrPicker master={master} value={exclude} onChange={setExclude} />
            </>
          )}

          {step === 5 && (
            <div className="grid cols-3">
              <div className="field"><label>게시 예정일</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="field"><label>예산 상한(원)</label>
                <input type="number" min={0} step={10000} value={budgetCapKrw} onChange={(e) => setBudgetCapKrw(Number(e.target.value))} />
              </div>
              <div className="field"><label>승인 레벨</label>
                <select value={approvalLevel} onChange={(e) => setApprovalLevel(Number(e.target.value))}>
                  <option value={0}>L0 전건 수동 승인</option>
                  <option value={1}>L1 92점 이상 + 위반 없음 자동</option>
                  <option value={2}>L2 85점 이상 자동</option>
                  <option value={3}>L3 QC PASS 전건 자동</option>
                </select>
              </div>
            </div>
          )}

          {step === 6 && (
            <>
              <h3>제출 내용</h3>
              <pre>{JSON.stringify(body, null, 2)}</pre>
              {validation && !validation.ok && (
                <div className="error" style={{ marginTop: 10 }}>
                  <strong>검증 실패</strong>
                  <pre style={{ marginTop: 8, marginBottom: 0 }}>{JSON.stringify(validation.errors, null, 2)}</pre>
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={() => void submit('draft')} disabled={busy}>DRAFT 로 저장</button>
                <button className="primary" onClick={() => void submit('submit')} disabled={busy || !artistId || !channelIds.length}>
                  {busy ? '처리 중…' : '검증 후 제출'}
                </button>
              </div>
            </>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>이전</button>
            <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1 || !canNext}>다음</button>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
          <h3>조건에 맞는 자산</h3>
          <div className="kpi">
            <span className="value" style={{ color: preview && preview.total > 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {preview?.total ?? '—'}건
            </span>
            <span className="label">아티스트 라이브러리 기준</span>
          </div>
          {preview && channelIds.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>채널별 사용 가능</h3>
              {preview.byChannel.map((b) => {
                const ch = channels.find((c) => c.id === b.channelId);
                return (
                  <div key={b.channelId} className="row" style={{ marginBottom: 4 }}>
                    <span className={`badge ${b.usable > 0 ? 'ok' : 'danger'}`}>{b.usable}</span>
                    <span className="sub">{ch?.handle} ({ch?.region})</span>
                  </div>
                );
              })}
              <div className="sub" style={{ marginTop: 8 }}>
                0건인 채널이 있으면 제출 시 LICENSE_CHANNEL_DENIED 로 반려됩니다.
              </div>
            </>
          )}
          <h3 style={{ marginTop: 14 }}>예상 규모</h3>
          <div className="sub">
            콘텐츠 {quantity * Math.max(1, channelIds.length)}건 · 예산 상한 <Money krw={budgetCapKrw} />
          </div>
          {validation?.ok && (
            <div className="badge ok" style={{ marginTop: 10 }}>
              예상 비용 {validation.estimatedCostKrw.toLocaleString()}원
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function AttrPicker({ master, value, onChange }: {
  master: MasterAttrs;
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
}) {
  return (
    <div className="grid cols-3">
      {Object.entries(master.attributes).map(([attr, values]) => (
        <div key={attr}>
          <label>{master.labels[attr] ?? attr}</label>
          <div className="row">
            {values.map((v) => {
              const on = (value[attr] ?? []).includes(v.value);
              return (
                <button key={v.id} className={on ? 'primary' : ''}
                  style={{ padding: '4px 9px', fontSize: 12 }}
                  onClick={() => {
                    const cur = value[attr] ?? [];
                    const next = on ? cur.filter((x) => x !== v.value) : [...cur, v.value];
                    onChange({ ...value, [attr]: next });
                  }}>
                  {v.value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function prune(r: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v && v.length));
}
