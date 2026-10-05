import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns every request a correlation id (docs/05 §79) so logs and error
 * responses can be tied together. An inbound id is trusted only for
 * correlation, never for authorization.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const requestId = typeof inbound === 'string' && inbound.length <= 64 ? inbound : randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  }
}
