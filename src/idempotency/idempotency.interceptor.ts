import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, from, switchMap, tap } from 'rxjs';
import { IDEMPOTENT_KEY } from '../common/decorators/idempotent.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { validationError } from '../common/errors/api-exception';
import { IdempotencyService } from './idempotency.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Guarantees a financially-sensitive write happens at most once even if the
 * client retries or double-taps (PROMPT-B.E §2.5).
 *
 * The claim is taken *before* the handler runs and the response is recorded
 * after, so a concurrent duplicate is rejected while the first is in flight
 * rather than racing it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isIdempotent) return next.handle();
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthenticatedUser; body: unknown }>();
    const res = http.getResponse<Response>();

    const rawKey = req.headers[IDEMPOTENCY_HEADER];
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (!key) {
      throw validationError(`The ${IDEMPOTENCY_HEADER} header is required for this operation.`, [
        { field: IDEMPOTENCY_HEADER, message: 'an Idempotency-Key header is required' },
      ]);
    }

    if (key.length > 255) {
      throw validationError('The Idempotency-Key header is too long.', [
        { field: IDEMPOTENCY_HEADER, message: 'must be at most 255 characters' },
      ]);
    }

    const requestHash = IdempotencyService.hashRequest(req.method, req.originalUrl, req.body);

    return from(
      this.idempotency.claim({
        key,
        userId: req.user?.id ?? null,
        businessId: req.user?.businessId ?? null,
        requestHash,
      }),
    ).pipe(
      switchMap((outcome) => {
        // A completed replay: return the stored response untouched.
        if (outcome.kind === 'replay') {
          res.status(outcome.status);
          return from([outcome.body]);
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.idempotency.complete(key, res.statusCode, body as Record<string, unknown>);
            },
            error: () => {
              // The handler threw, so nothing committed. Free the key so a
              // corrected retry is not permanently blocked.
              void this.idempotency.release(key);
            },
          }),
        );
      }),
    );
  }
}
