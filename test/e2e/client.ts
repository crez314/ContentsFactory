import { config } from '@cf/common';

const BASE = process.env.E2E_API_BASE ?? `http://localhost:${config.ports.api}/v1`;

export class E2eError extends Error {
  constructor(readonly code: string, message: string, readonly details: unknown[] = []) {
    super(`${code}: ${message}`);
  }
}

export class Client {
  private accessToken: string | null = null;

  async login(email: string, password: string): Promise<{ id: string; role: string; name: string }> {
    const r = await this.raw('POST', '/auth/login', { email, password });
    this.accessToken = (r as { accessToken: string }).accessToken;
    return (r as { user: { id: string; role: string; name: string } }).user;
  }

  get<T>(path: string): Promise<T> { return this.raw('GET', path) as Promise<T>; }
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.raw('POST', path, body, headers) as Promise<T>;
  }
  patch<T>(path: string, body: unknown): Promise<T> { return this.raw('PATCH', path, body) as Promise<T>; }

  private async raw(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const res = await fetch(`${BASE}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const e = parsed.error ?? {};
      throw new E2eError(e.code ?? 'HTTP_' + res.status, e.message ?? res.statusText, e.details ?? []);
    }
    return parsed.data;
  }
}

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  { timeoutMs = 180_000, intervalMs = 2000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await fn();
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${label}; last=${JSON.stringify(last).slice(0, 400)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── 간단한 assert 헬퍼 (테스트 러너 없이 단독 실행하기 위한 것)
let passed = 0;
const failures: string[] = [];

export function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(label);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

export function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

export function summarize(): never {
  console.log(`\n${failures.length ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failures.length} failed\x1b[0m`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}
