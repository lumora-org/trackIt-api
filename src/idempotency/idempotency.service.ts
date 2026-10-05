import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, QueryFailedError, QueryDeepPartialEntity, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { IdempotencyKey, IdempotentSnapshot } from './entities/idempotency-key.entity';
import { apiError } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';

/** PROMPT-B.E §2.5 suggests 24h retention. */
export const IDEMPOTENCY_RETENTION_HOURS = 24;

export interface IdempotencyScope {
  key: string;
  userId: string | null;
  businessId: string | null;
  requestHash: string;
}

export type IdempotencyOutcome =
  { kind: 'execute' } | { kind: 'replay'; status: number; body: unknown };

@Injectable()
export class IdempotencyService implements OnModuleInit {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repository: Repository<IdempotencyKey>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.pruneExpired();
  }

  /**
   * Canonical hash of the request, so a replay with a *different* payload can be
   * distinguished from a genuine retry.
   */
  static hashRequest(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method.toUpperCase()} ${path}`)
      .update('|')
      .update(IdempotencyService.canonicalise(body))
      .digest('hex');
  }

  /**
   * Claims the key.
   *
   * - First use: the row is inserted and the caller proceeds.
   * - Same key, same payload, completed: the stored response is replayed so the
   *   side effect never happens twice.
   * - Same key, different payload: 409 DUPLICATE_REQUEST.
   * - Same key, still in flight: 409 DUPLICATE_REQUEST, because a concurrent
   *   duplicate is exactly the race the key exists to stop.
   */
  async claim(scope: IdempotencyScope): Promise<IdempotencyOutcome> {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000);

    try {
      await this.repository.insert({
        key: scope.key,
        userId: scope.userId,
        businessId: scope.businessId,
        requestHash: scope.requestHash,
        responseStatus: null,
        responseSnapshot: null,
        expiresAt,
      });

      return { kind: 'execute' };
    } catch (error) {
      if (!(error instanceof QueryFailedError) || this.driverCode(error) !== '23505') {
        throw error;
      }
    }

    // The key already exists: this is a replay.
    const existing = await this.repository.findOne({ where: { key: scope.key } });

    if (!existing) {
      // Vanished between the failed insert and this read; treat as first use.
      return { kind: 'execute' };
    }

    if (existing.requestHash !== scope.requestHash) {
      throw apiError(
        ErrorCode.DUPLICATE_REQUEST,
        'This idempotency key was already used with a different request payload.',
      );
    }

    if (existing.responseStatus === null) {
      throw apiError(ErrorCode.DUPLICATE_REQUEST, 'An identical request is still being processed.');
    }

    return {
      kind: 'replay',
      status: existing.responseStatus,
      body: existing.responseSnapshot,
    };
  }

  /** Stores the response so a later replay can return it verbatim. */
  async complete(key: string, status: number, body: IdempotentSnapshot | null): Promise<void> {
    try {
      // Cast: TypeORM recurses into Record<string, unknown> when deriving
      // DeepPartial, which trips the compiler depth limit for jsonb columns.
      const patch = {
        responseStatus: status,
        responseSnapshot: body,
      } as QueryDeepPartialEntity<IdempotencyKey>;
      await this.repository.update(key, patch);
    } catch (error) {
      // The business effect already committed; losing the snapshot only means a
      // retry would be re-evaluated, so this must not fail the request.
      this.logger.error(`Failed to store idempotent response for key ${key}`, error as Error);
    }
  }

  /** Releases a claim so a genuinely failed request can be retried. */
  async release(key: string): Promise<void> {
    await this.repository.delete(key);
  }

  async pruneExpired(): Promise<number> {
    const cutoff = new Date();
    const result = await this.repository.delete({ expiresAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }

  private driverCode(error: QueryFailedError): string | undefined {
    return (error.driverError as { code?: string } | undefined)?.code;
  }

  /** Stable JSON with sorted keys, so key order cannot change the hash. */
  private static canonicalise(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) {
      return `[${value.map((item) => IdempotencyService.canonicalise(item)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${IdempotencyService.canonicalise(item)}`);

    return `{${entries.join(',')}}`;
  }
}
