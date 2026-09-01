'use client';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000/v1';

const ACCESS_KEY = 'cf.accessToken';
const REFRESH_KEY = 'cf.refreshToken';
const USER_KEY = 'cf.user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ROOT' | 'ADMIN' | 'OPERATOR' | 'REVIEWER' | 'VIEWER';
}

export const tokens = {
  get access(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY);
  },
  get user(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  },
  save(t: { accessToken: string; refreshToken: string; user: AuthUser }): void {
    localStorage.setItem(ACCESS_KEY, t.accessToken);
    localStorage.setItem(REFRESH_KEY, t.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(t.user));
  },
  clear(): void {
    [ACCESS_KEY, REFRESH_KEY, USER_KEY].forEach((k) => localStorage.removeItem(k));
  },
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown[] = [],
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  data: T;
  meta: { requestId: string; nextCursor: string | null };
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const access = tokens.access;
  if (access) headers.set('authorization', `Bearer ${access}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (cause) {
    // fetch 가 던지면 브라우저는 'Failed to fetch' 밖에 주지 않는다.
    // 그대로 보여주면 사용자가 무엇을 해야 할지 알 수 없으므로 원인과 조치를 붙인다.
    throw new ApiError(
      'API_UNREACHABLE',
      `API 서버에 연결할 수 없습니다 (${API_BASE}). API 프로세스가 떠 있는지 확인하세요.`,
      [{ hint: 'pnpm start:api 또는 pnpm dev 로 API 를 기동한 뒤 새로고침하세요.', apiBase: API_BASE, path,
         cause: cause instanceof Error ? cause.message : String(cause) }],
      0,
    );
  }

  if (res.status === 401 && retry && tokens.refresh) {
    // 액세스 토큰 만료 — 회전 발급을 한 번만 시도한다.
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    });
    if (refreshed.ok) {
      const body = (await refreshed.json()) as Envelope<{ accessToken: string; refreshToken: string; user: AuthUser }>;
      tokens.save(body.data);
      return request<T>(path, init, false);
    }
    tokens.clear();
    if (typeof window !== 'undefined') window.location.href = '/login';
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = body.error ?? {};
    throw new ApiError(e.code ?? 'INTERNAL_ERROR', e.message ?? res.statusText, e.details ?? [], res.status);
  }
  return body as Envelope<T>;
}

export const api = {
  get: <T,>(path: string) => request<T>(path).then((r) => r),
  post: <T,>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function login(email: string, password: string): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (cause) {
    throw new ApiError(
      'API_UNREACHABLE',
      `API 서버에 연결할 수 없습니다 (${API_BASE}).`,
      [{ hint: 'pnpm start:api 또는 pnpm dev 로 API 를 기동한 뒤 다시 시도하세요.', apiBase: API_BASE,
         cause: cause instanceof Error ? cause.message : String(cause) }],
      0,
    );
  }
  const body = await res.json();
  if (!res.ok) {
    const e = body.error ?? {};
    throw new ApiError(e.code ?? 'AUTH_INVALID_CREDENTIALS', e.message ?? '로그인에 실패했습니다.', e.details, res.status);
  }
  tokens.save(body.data);
  return body.data.user as AuthUser;
}

export async function logout(): Promise<void> {
  const refreshToken = tokens.refresh;
  tokens.clear();
  if (refreshToken) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
}

/** §6.2 랭크 비교. 승인 계열은 canReview 로 따로 본다. */
const RANK = { VIEWER: 0, REVIEWER: 1, OPERATOR: 2, ADMIN: 3, SUPER_ROOT: 4 } as const;
export const hasMinRole = (role: AuthUser['role'] | undefined, min: keyof typeof RANK): boolean =>
  role ? RANK[role] >= RANK[min] : false;
export const canReview = (role: AuthUser['role'] | undefined): boolean =>
  role ? ['REVIEWER', 'ADMIN', 'SUPER_ROOT'].includes(role) : false;
