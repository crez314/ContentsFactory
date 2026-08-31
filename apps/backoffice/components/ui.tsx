'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

export function StatusBadge({ status }: { status: string }) {
  const tone =
    ['PUBLISHED', 'DONE', 'APPROVED', 'ACTIVE', 'PASS', 'UPLOADED'].includes(status) ? 'ok'
    : ['FAILED', 'BLOCKED', 'REJECTED', 'QC_FAILED', 'ESCALATED', 'SUSPENDED'].includes(status) ? 'danger'
    : ['READY', 'RETRY', 'FALLBACK', 'PARTIAL', 'PAUSED', 'PAUSED_BUDGET', 'FAIL'].includes(status) ? 'warn'
    : 'info';
  return <span className={`badge ${tone}`}>{status}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="error" style={{ marginBottom: 12 }}>
      <strong>{e.code ?? 'ERROR'}</strong> — {e.message}
      {Array.isArray(e.details) && e.details.length > 0 && (
        <pre style={{ marginTop: 8, marginBottom: 0 }}>{JSON.stringify(e.details, null, 2)}</pre>
      )}
    </div>
  );
}

export function Money({ krw }: { krw: number | null | undefined }) {
  return <span>{(krw ?? 0).toLocaleString('ko-KR')}원</span>;
}

export function Progress({ percent }: { percent: number }) {
  return (
    <div className="bar" title={`${percent}%`}>
      <div style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 90 ? 'var(--ok)' : score >= 75 ? 'var(--accent)' : score >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="scorebar" style={{ marginBottom: 6 }}>
      <span style={{ width: 76, fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span className="track"><span className="fill" style={{ width: `${score}%`, background: color }} /></span>
      <span className="mono" style={{ width: 44, textAlign: 'right' }}>{score.toFixed(1)}</span>
    </div>
  );
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export function duration(ms: number | null | undefined): string {
  if (!ms) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

/** 폴링 훅 — Task 모니터·대시보드처럼 계속 변하는 화면에 쓴다. */
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 0, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await fn();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void tick();
    if (!intervalMs) return () => { alive = false; };
    const timer = setInterval(() => void tick(), intervalMs);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (e) { setError(e); }
  };

  return { data, error, loading, reload, setData };
}
