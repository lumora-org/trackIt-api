export enum FuelOrderStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  IN_TRANSIT = 'IN_TRANSIT',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/**
 * DISPUTED was removed from the workflow: a delivery is either received into
 * stock or cancelled. (The `delivery_status` DB enum still carries the
 * historical value; nothing writes it any more.)
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum InventoryTransactionType {
  OPENING_BALANCE = 'OPENING_BALANCE',
  DELIVERY = 'DELIVERY',
  SALE = 'SALE',
  ADJUSTMENT = 'ADJUSTMENT',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
  CORRECTION = 'CORRECTION',
}

export enum InventoryReferenceType {
  OPENING_BALANCE = 'OPENING_BALANCE',
  DELIVERY = 'DELIVERY',
  SALE = 'SALE',
  ADJUSTMENT = 'ADJUSTMENT',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
  CORRECTION = 'CORRECTION',
  DAILY_REPORT = 'DAILY_REPORT',
}

/**
 * How a sale row was recorded (product decision, 2026-10):
 *
 * - SINGLE    one counter transaction, recorded as it happens.
 * - DAY_TOTAL the branch's running total litres sold for one fuel on one
 *             business day. The manager revises the figure during the day and
 *             the ledger only ever moves by the delta, so the row always shows
 *             the day's authoritative total.
 */
export enum SaleRecordMode {
  SINGLE = 'SINGLE',
  DAY_TOTAL = 'DAY_TOTAL',
}

/**
 * The admin confirmation gate on a recorded sale (product decision, 2026-10):
 *
 * - PENDING  a manager recorded the figure; an admin must confirm it.
 * - APPROVED an admin confirmed the figure (or an admin recorded it themselves,
 *            which is a confirmation by definition).
 * - REJECTED an admin refused the figure with a reason; the manager revises
 *            the day total, which returns it to PENDING.
 *
 * Approval is workflow metadata, not accounting state: a sale's litres and
 * amount count exactly the same whatever the status, so no aggregate shifts
 * while a figure awaits review.
 */
export enum SaleApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
