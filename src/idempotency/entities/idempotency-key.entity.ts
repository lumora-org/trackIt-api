import { ApiHideProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Idempotency ledger for financially-sensitive writes (PROMPT-B.E §2.5).
 *
 * The frontend sends an `Idempotency-Key` header on every dangerous write. The
 * first execution wins and its response is snapshotted; a replay returns that
 * snapshot instead of repeating the side effect. A replay with a *different*
 * payload is a client bug and is rejected with 409 DUPLICATE_REQUEST.
 *
 * docs/03 §83 treats idempotency as a future column and doc 05 §111 describes a
 * different shape; PROMPT-B.E's table is the one the frontend contract needs, so
 * it wins (documented deviation).
 */
/**
 * The stored snapshot is always the response envelope (`{ data, meta? }`), so it
 * is typed concretely rather than as a recursive JsonValue union — the latter
 * makes TypeORM's DeepPartial inference exceed the compiler depth limit.
 */
export type IdempotentSnapshot = Record<string, unknown>;

@Index('idempotency_keys_user_id', ['userId'])
@Index('idempotency_keys_created_at', ['createdAt'])
@Entity({ name: 'idempotency_keys' })
export class IdempotencyKey {
  @ApiHideProperty()
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'business_id', type: 'uuid', nullable: true })
  businessId!: string | null;

  /** SHA-256 of the canonical request payload, to detect payload drift. */
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_snapshot', type: 'jsonb', nullable: true })
  responseSnapshot!: IdempotentSnapshot | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Retained for 24h per PROMPT-B.E §2.5, then swept. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
