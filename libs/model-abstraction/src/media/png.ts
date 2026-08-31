import { deflateSync } from 'zlib';

/**
 * 의존성 없는 최소 PNG 인코더.
 * Mock 어댑터가 "실제로 열리는" 이미지 파일을 만들기 위한 것이다.
 * 이렇게 해야 QC 의 해상도·화면비·파일 무결성 검사가 진짜로 동작한다.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export type RgbPainter = (x: number, y: number) => [number, number, number];

export function encodePng(width: number, height: number, paint: RgbPainter): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = rowStart + 1 + x * 3;
      raw[o] = r & 0xff;
      raw[o + 1] = g & 0xff;
      raw[o + 2] = b & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG 헤더에서 해상도를 읽는다. QC quality 영역의 정적 검사에 쓰인다. */
export function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * 시드 문자열에서 결정적으로 그라디언트 이미지를 만든다.
 * 같은 프롬프트는 같은 그림이 나오므로 캐시 동작을 눈으로 확인할 수 있다.
 */
export function syntheticImage(opts: {
  width: number;
  height: number;
  seed: string;
  palette?: string[];
}): Buffer {
  const h = hashString(opts.seed);
  const palette = (opts.palette?.length ? opts.palette : ['#2B4F81', '#E8C07D']).map(hexToRgb);
  const c0 = palette[h % palette.length];
  const c1 = palette[(h >>> 8) % palette.length];
  const angle = ((h >>> 16) % 360) * (Math.PI / 180);
  const bandFreq = 3 + ((h >>> 4) % 5);

  return encodePng(opts.width, opts.height, (x, y) => {
    const nx = x / opts.width - 0.5;
    const ny = y / opts.height - 0.5;
    const proj = nx * Math.cos(angle) + ny * Math.sin(angle) + 0.5;
    const band = 0.5 + 0.5 * Math.sin(proj * Math.PI * bandFreq);
    const t = Math.min(1, Math.max(0, proj * 0.7 + band * 0.3));
    const vignette = 1 - 0.35 * Math.min(1, (nx * nx + ny * ny) * 2.2);
    return [
      Math.round((c0[0] + (c1[0] - c0[0]) * t) * vignette),
      Math.round((c0[1] + (c1[1] - c0[1]) * t) * vignette),
      Math.round((c0[2] + (c1[2] - c0[2]) * t) * vignette),
    ];
  });
}
