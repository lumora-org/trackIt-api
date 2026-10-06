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
