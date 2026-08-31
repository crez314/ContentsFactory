import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestId as newRequestId } from '@cf/common';

/** §5.1 모든 응답에 X-Request-Id */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && /^[\w.-]{6,80}$/.test(incoming) ? incoming : newRequestId();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}
