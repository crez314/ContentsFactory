import { z } from 'zod';

/** §5.1 공통 응답 봉투 */
export interface ApiMeta { requestId: string; nextCursor: string | null }
export interface ApiResponse<T> { data: T; meta: ApiMeta }
export interface ApiErrorBody {
  error: { code: string; message: string; details: unknown[]; requestId: string };
}

export const Uuid = z.string().uuid();
export const IsoDateTime = z.string().datetime();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.');

export const PagingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type PagingQuery = z.infer<typeof PagingQuery>;
