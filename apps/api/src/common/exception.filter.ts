import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ZodError } from 'zod';
import { AppError, createLogger } from '@cf/common';

const log = createLogger('http');

/** §5.1 오류 응답 봉투 — { error: { code, message, details, requestId } } */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.requestId ?? 'unknown';

    if (err instanceof AppError) {
      if (err.http >= 500) log.error('request failed', { requestId, code: err.code, err });
      else log.warn('request rejected', { requestId, code: err.code, details: err.details });
      res.status(err.http).json({ error: { ...err.toJSON(), requestId } });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: '입력값이 올바르지 않습니다.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId,
        },
      });
      return;
    }

    if (err instanceof HttpException) {
      const body = err.getResponse();
      res.status(err.getStatus()).json({
        error: {
          code: err.getStatus() === 404 ? 'NOT_FOUND' : 'INVALID_INPUT',
          message: typeof body === 'string' ? body : ((body as { message?: string }).message ?? err.message),
          details: [],
          requestId,
        },
      });
      return;
    }

    log.error('unhandled error', { requestId, err });
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '내부 오류가 발생했습니다.', details: [], requestId },
    });
  }
}
