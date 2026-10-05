import { createHash } from 'node:crypto';

/**
 * Stable 63-bit key for a (branch, fuel type) stock bucket.
 *
 * docs/03 §92 forbids an authoritative `current_stock` table in the MVP, and
 * docs/03 §73–§74 makes stock a SUM over the ledger. That combination leaves
 * nothing to `SELECT ... FOR UPDATE`, because an aggregate cannot be row-locked.
 *
 * Closing that gap is this module's main concurrency decision: a PostgreSQL
 * transaction-level advisory lock keyed on the branch+fuel pair serialises every
 * read-modify-write of one stock bucket, so two concurrent sales cannot both read
 * the same pre-sale balance and both succeed. The lock is released automatically
 * when the transaction commits or rolls back, so there is no lock table to leak.
 */
export function stockLockKey(branchId: string, fuelTypeId: string): bigint {
  const digest = createHash('sha256').update(`${branchId}:${fuelTypeId}`).digest();
  // Mask to 63 bits. The result is in [0, 2^63) so it always fits PostgreSQL's
  // signed `bigint` and is never negative.
  //
  // Note: do not wrap this in BigInt.asIntN(63, …) — that reinterprets bit 62
  // as a sign bit and would return a negative key for half of all inputs.
  return digest.readBigUInt64BE(0) & ((1n << 63n) - 1n);
}
