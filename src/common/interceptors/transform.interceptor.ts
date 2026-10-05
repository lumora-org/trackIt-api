import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { PaginatedResult } from '../interfaces/paginated-result.interface';

export const RAW_RESPONSE_KEY = 'trackit:rawResponse';

/**
 * Marks a route whose body must be returned verbatim — `GET /inventory` is the
 * documented exception, returning a bare array (PROMPT-B.E §2.2).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRaw) return next.handle();

    const http = context.switchToHttp();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((payload: unknown) => {
        // 204 No Content responses carry an empty body (logout, user delete).
        if (response.statusCode === 204 || payload === undefined || payload === null) {
          return payload;
        }

        // An empty array is a legitimate empty collection, not "no content".
        if (payload instanceof PaginatedResult) {
          return { data: payload.items, meta: payload.meta };
        }

        return { data: payload };
      }),
    );
  }
}

/** Convenience for controllers that need the raw request for IP/UA capture. */
export type RequestWithId = Request & { requestId?: string };
