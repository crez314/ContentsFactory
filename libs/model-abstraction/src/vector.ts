/** §4.5 Identity 검증에 쓰이는 벡터 연산 */

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const cosineAll = (refs: number[][], v: number[]): number[] => refs.map((r) => cosine(r, v));

/** 상위 K개 평균. 기준 자산 중 가장 잘 맞는 것들만 본다. */
export function topKMean(scores: number[], k: number): number {
  if (!scores.length) return 0;
  const sorted = [...scores].sort((a, b) => b - a).slice(0, Math.max(1, k));
  return sorted.reduce((s, v) => s + v, 0) / sorted.length;
}
