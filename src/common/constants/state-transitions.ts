import { DeliveryStatus, FuelOrderStatus } from '../enums/fuel.enum';
import { DailyReportStatus } from '../enums/report.enum';
/**
 * Legal fuel-order transitions (PROMPT-B.E §3, docs/09 §9).
 *
 * Two edges are added beyond the linear chain in docs/09, which are required for
 * the documented workflow to function and are called out as deviations:
 *
 * 1. `IN_TRANSIT → DELIVERED`. The documented chain forces
 *    IN_TRANSIT → PARTIALLY_DELIVERED → DELIVERED, which leaves a single
 *    full-tanker delivery (45,000 of 45,000 in one load) with no legal edge at
 *    all. Receiving the whole order in one delivery must be expressible.
 *
 * 2. `CONFIRMED → IN_TRANSIT` is present in docs/04 §45 and is therefore
 *    authoritative even though docs/09 §16 omits the endpoint.
 *
 * `DELIVERED` and `CANCELLED` are terminal.
 */
export const FUEL_ORDER_TRANSITIONS: Readonly<Record<FuelOrderStatus, readonly FuelOrderStatus[]>> =
  {
    DRAFT: [FuelOrderStatus.SUBMITTED, FuelOrderStatus.CANCELLED],
    SUBMITTED: [FuelOrderStatus.CONFIRMED, FuelOrderStatus.CANCELLED],
    CONFIRMED: [FuelOrderStatus.IN_TRANSIT, FuelOrderStatus.CANCELLED],
    IN_TRANSIT: [FuelOrderStatus.PARTIALLY_DELIVERED, FuelOrderStatus.DELIVERED],
    PARTIALLY_DELIVERED: [FuelOrderStatus.DELIVERED],
    DELIVERED: [],
    CANCELLED: [],
  };

/** Only these orders may be cancelled (docs/09 §9). */
export const CANCELLABLE_FUEL_ORDER_STATUSES: readonly FuelOrderStatus[] = [
  FuelOrderStatus.DRAFT,
  FuelOrderStatus.SUBMITTED,
  FuelOrderStatus.CONFIRMED,
];

export const isTerminalFuelOrderStatus = (status: FuelOrderStatus): boolean =>
  FUEL_ORDER_TRANSITIONS[status].length === 0;

export const canTransitionFuelOrder = (from: FuelOrderStatus, to: FuelOrderStatus): boolean =>
  FUEL_ORDER_TRANSITIONS[from].includes(to);

/** Legal daily-report transitions (PROMPT-B.E §3, docs/05 §57). */
export const DAILY_REPORT_TRANSITIONS: Readonly<
  Record<DailyReportStatus, readonly DailyReportStatus[]>
> = {
  DRAFT: [DailyReportStatus.SUBMITTED],
  SUBMITTED: [
    DailyReportStatus.UNDER_REVIEW,
    DailyReportStatus.APPROVED,
    DailyReportStatus.REJECTED,
  ],
  UNDER_REVIEW: [DailyReportStatus.APPROVED, DailyReportStatus.REJECTED],
  APPROVED: [],
  REJECTED: [DailyReportStatus.DRAFT],
};

export const canTransitionDailyReport = (from: DailyReportStatus, to: DailyReportStatus): boolean =>
  DAILY_REPORT_TRANSITIONS[from].includes(to);

/** Legal delivery transitions (PROMPT-B.E §3). */
export const DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  PENDING: [DeliveryStatus.RECEIVED, DeliveryStatus.DISPUTED, DeliveryStatus.CANCELLED],
  RECEIVED: [],
  DISPUTED: [],
  CANCELLED: [],
};

export const canTransitionDelivery = (from: DeliveryStatus, to: DeliveryStatus): boolean =>
  DELIVERY_TRANSITIONS[from].includes(to);
