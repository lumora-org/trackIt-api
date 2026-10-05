import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** Never log these, regardless of what a client sends (PROMPT.md §14). */
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'password',
  'refreshtoken',
  'idempotency-key',
]);

interface RequestWithContext extends Request {
  requestId?: string;
  user?: AuthenticatedUser;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithContext>();
    const res = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const payload = {
        requestId: req.requestId,
        method: req.method,
        path: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id ?? null,
        role: req.user?.role ?? null,
        businessId: req.user?.businessId ?? null,
        branchId: req.user?.branchId ?? null,
      };

      const line = JSON.stringify(payload);
      if (res.statusCode >= 500) this.logger.error(line);
      else if (res.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });

    return next.handle();
  }
}

/** Exposed for tests/diagnostics; keeps the redaction list in one place. */
export const isSensitiveHeader = (name: string): boolean =>
  REDACTED_HEADERS.has(name.toLowerCase());
