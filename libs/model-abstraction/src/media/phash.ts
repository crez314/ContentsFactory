import { readPngSize } from './png';
import { inflateSync } from 'zlib';

/**
 * §4.8.1 지각 해시 (pHash, DCT 64bit).
 *
 * 정품 표식의 최후 대조 수단이다. C2PA 매니페스트는 플랫폼 업로드 과정에서 자주 제거되고
 * 워터마크도 추출에 실패할 수 있으므로, 재인코딩·크롭 이후에도 남는 지각 해시가 필요하다.
 *
 * 외부 의존성 없이 구현한다 — 32x32 그레이스케일로 축소 → 2D DCT → 좌상단 8x8 저주파
 * 계수의 중앙값 기준 이진화. 이미지 처리 라이브러리를 붙이면 이 파일만 교체하면 된다.
 */

const DCT_SIZE = 32;
const HASH_SIDE = 8;

/** 두 해시의 해밍 거리. 0 이면 동일, 보통 10 이하면 같은 원본으로 본다. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** 미리 계산한 DCT 계수 테이블 — cos((2x+1)uπ / 2N) */
const COS_TABLE = (() => {
  const t: number[][] = [];
  for (let u = 0; u < DCT_SIZE; u++) {
    t[u] = [];
    for (let x = 0; x < DCT_SIZE; x++) {
      t[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE));
    }
  }
  return t;
})();

function dct2d(matrix: number[][]): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < DCT_SIZE; y++) {
    rows[y] = [];
    for (let u = 0; u < DCT_SIZE; u++) {
      let sum = 0;
      for (let x = 0; x < DCT_SIZE; x++) sum += matrix[y][x] * COS_TABLE[u][x];
      rows[y][u] = sum * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  const out: number[][] = [];
  for (let v = 0; v < DCT_SIZE; v++) {
    out[v] = [];
    for (let u = 0; u < DCT_SIZE; u++) {
      let sum = 0;
      for (let y = 0; y < DCT_SIZE; y++) sum += rows[y][u] * COS_TABLE[v][y];
      out[v][u] = sum * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return out;
}

/** 32x32 그레이스케일 행렬 → 64bit pHash (16자리 hex) */
export function phashFromGrayscale(gray: number[][]): string {
  const coeffs = dct2d(gray);

  // 좌상단 8x8 저주파. DC(0,0)는 전체 밝기라 제외한다.
  const low: number[] = [];
  for (let v = 0; v < HASH_SIDE; v++) {
    for (let u = 0; u < HASH_SIDE; u++) {
      if (u === 0 && v === 0) continue;
      low.push(coeffs[v][u]);
    }
  }
  const sorted = [...low].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let bits = '';
  let idx = 0;
  for (let v = 0; v < HASH_SIDE; v++) {
    for (let u = 0; u < HASH_SIDE; u++) {
      if (u === 0 && v === 0) { bits += '0'; continue; }
      bits += low[idx++] > median ? '1' : '0';
    }
  }

  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/**
 * PNG 버퍼에서 pHash 를 계산한다.
 * 우리 인코더가 만든 필터 0(None) · 트루컬러 PNG 를 대상으로 한다.
 * 그 외 형식이면 null 을 돌려주고, 호출자는 프레임 시그니처로 대체한다.
 */
export function phashFromPng(buf: Buffer): string | null {
  const size = readPngSize(buf);
  if (!size) return null;

  const pixels = decodeTruecolorPng(buf, size.width, size.height);
  if (!pixels) return null;   // 지원하지 않는 PNG 변형 — 호출자가 대체 수단을 쓴다

  // 최근접 이웃으로 32x32 축소 + 그레이스케일
  const gray: number[][] = [];
  for (let y = 0; y < DCT_SIZE; y++) {
    gray[y] = [];
    const sy = Math.min(size.height - 1, Math.floor((y * size.height) / DCT_SIZE));
    for (let x = 0; x < DCT_SIZE; x++) {
      const sx = Math.min(size.width - 1, Math.floor((x * size.width) / DCT_SIZE));
      const o = (sy * size.width + sx) * 3;
      gray[y][x] = 0.299 * pixels[o] + 0.587 * pixels[o + 1] + 0.114 * pixels[o + 2];
    }
  }
  return phashFromGrayscale(gray);
}

/**
 * IDAT 를 이어붙여 압축을 풀고 스캔라인 필터를 되돌린다.
 *
 * ffmpeg 이 만든 PNG 는 적응형 필터(Sub/Up/Average/Paeth)를 쓰므로
 * 필터 0(None)만 지원하면 프레임 해시를 못 뽑는다. PNG 명세의 5종을 모두 처리한다.
 */
function decodeTruecolorPng(buf: Buffer, width: number, height: number): Buffer | null {
  try {
    const bitDepth = buf[24];
    const colorType = buf[25];
    if (bitDepth !== 8) return null;
    // 2 = 트루컬러(RGB), 6 = 트루컬러+알파(RGBA)
    if (colorType !== 2 && colorType !== 6) return null;
    const bpp = colorType === 6 ? 4 : 3;

    const chunks: Buffer[] = [];
    let off = 8;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'IDAT') chunks.push(buf.subarray(off + 8, off + 8 + len));
      if (type === 'IEND') break;
      off += 12 + len;
    }
    if (!chunks.length) return null;

    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * bpp;
    if (raw.length < (stride + 1) * height) return null;

    // 필터를 되돌린 원본 스캔라인
    const recon = Buffer.alloc(stride * height);

    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      const up = dst - stride;

      for (let i = 0; i < stride; i++) {
        const x = raw[src + i];
        const a = i >= bpp ? recon[dst + i - bpp] : 0;          // 왼쪽
        const b = y > 0 ? recon[up + i] : 0;                     // 위
        const c = y > 0 && i >= bpp ? recon[up + i - bpp] : 0;   // 왼쪽 위

        let value: number;
        switch (filter) {
          case 0: value = x; break;                              // None
          case 1: value = x + a; break;                          // Sub
          case 2: value = x + b; break;                          // Up
          case 3: value = x + ((a + b) >> 1); break;             // Average
          case 4: value = x + paeth(a, b, c); break;             // Paeth
          default: return null;
        }
        recon[dst + i] = value & 0xff;
      }
    }

    if (bpp === 3) return recon;

    // RGBA 는 알파를 버리고 RGB 로 좁힌다 (지각 해시는 휘도만 본다).
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, o = 0; i < recon.length; i += 4, o += 3) {
      rgb[o] = recon[i];
      rgb[o + 1] = recon[i + 1];
      rgb[o + 2] = recon[i + 2];
    }
    return rgb;
  } catch {
    return null;
  }
}

/** PNG 명세의 Paeth 예측자 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
