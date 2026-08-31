import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface Paged<T> { items: T[]; nextCursor: string | null }

export const isPaged = <T>(v: unknown): v is Paged<T> =>
  typeof v === 'object' && v !== null && Array.isArray((v as Paged<T>).items) && 'nextCursor' in (v as object);

/** §5.1 성공 응답 봉투 — { data, meta: { requestId, nextCursor } } */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const requestId: string = req.requestId ?? 'unknown';
    return next.handle().pipe(
      map((body: unknown) =>
        isPaged(body)
          ? { data: body.items, meta: { requestId, nextCursor: body.nextCursor } }
          : { data: body ?? null, meta: { requestId, nextCursor: null } },
      ),
    );
  }
}
