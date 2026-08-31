export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const DAY_MS = 86_400_000;

export function daysSince(date: Date | string | null | undefined, now = new Date()): number {
  if (!date) return 3650; // 촬영일 미상은 아주 오래된 것으로 취급
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, (now.getTime() - d.getTime()) / DAY_MS);
}

export function daysUntil(date: Date | string | null | undefined, now = new Date()): number {
  if (!date) return 0;
  const d = typeof date === 'string' ? new Date(date) : date;
  return (d.getTime() - now.getTime()) / DAY_MS;
}

export function isAfter(a: Date | string, b: Date | string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 지수 백오프 §3.4 — 2s → 8s → 32s */
export function backoffMs(attempt: number): number {
  return 2000 * Math.pow(4, Math.max(0, attempt - 1));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
