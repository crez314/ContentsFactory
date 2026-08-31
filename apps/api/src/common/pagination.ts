import { AppError } from '@cf/common';

export interface CursorPage {
  limit: number;
  cursor?: { createdAt: string; id: string };
}

/** §5.1 커서 페이징 — ?limit=20&cursor=<opaque> */
export function parsePaging(query: { limit?: string; cursor?: string }, defaultLimit = 20): CursorPage {
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? defaultLimit) || defaultLimit));
  if (!query.cursor) return { limit };
  try {
    const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') throw new Error('bad shape');
    return { limit, cursor: decoded };
  } catch {
    throw new AppError('INVALID_INPUT', { message: 'cursor 형식이 올바르지 않습니다.' });
  }
}

export function encodeCursor(row: { createdAt: Date | string; id: string } | undefined): string | null {
  if (!row) return null;
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  return Buffer.from(JSON.stringify({ createdAt, id: row.id })).toString('base64url');
}
