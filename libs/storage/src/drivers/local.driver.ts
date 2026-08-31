import * as fs from 'fs/promises';
import * as path from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '@cf/common';
import type { ObjectHead, StorageDriver } from '../contracts';

/**
 * 로컬 파일시스템 드라이버.
 * AWS 없이 개발·테스트하기 위한 것으로, S3 드라이버와 동일한 계약을 구현한다.
 * 서명은 HMAC-SHA256(key|exp|op) 로 만들고 API 의 /v1/files 라우트가 검증한다.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(opts: { root?: string; baseUrl?: string; secret?: string } = {}) {
    this.root = path.resolve(process.cwd(), opts.root ?? config.storage.localRoot);
    this.baseUrl = (opts.baseUrl ?? config.storage.cdnBaseUrl).replace(/\/$/, '');
    this.secret = opts.secret ?? config.auth.accessSecret;
  }

  private abs(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(this.root, normalized);
    if (!full.startsWith(this.root)) throw new Error(`storage key escapes root: ${key}`);
    return full;
  }

  sign(key: string, expEpochSec: number, op: 'GET' | 'PUT'): string {
    return createHmac('sha256', this.secret).update(`${key}|${expEpochSec}|${op}`).digest('hex');
  }

  verify(key: string, expEpochSec: number, op: 'GET' | 'PUT', signature: string): boolean {
    if (!Number.isFinite(expEpochSec) || expEpochSec * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(key, expEpochSec, op));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private url(key: string, ttlSec: number, op: 'GET' | 'PUT'): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.sign(key, exp, op);
    const q = new URLSearchParams({ key, exp: String(exp), op, sig });
    return `${this.baseUrl}?${q.toString()}`;
  }

  async presignPut(key: string, _contentType: string, ttlSec: number): Promise<string> {
    return this.url(key, ttlSec, 'PUT');
  }
  async presignGet(key: string, ttlSec: number): Promise<string> {
    return this.url(key, ttlSec, 'GET');
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const st = await fs.stat(this.abs(key));
      return { size: st.size, lastModified: st.mtime };
    } catch {
      return null;
    }
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const full = this.abs(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async materialize(key: string): Promise<string> {
    return this.abs(key);
  }

  async copy(from: string, to: string): Promise<void> {
    const dst = this.abs(to);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(this.abs(from), dst);
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.abs(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }
}
