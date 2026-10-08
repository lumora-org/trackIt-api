import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { Branch } from '../branches/entities/branch.entity';
import { Business } from '../businesses/entities/business.entity';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { DeliveryItem } from '../deliveries/entities/delivery-item.entity';
import { Delivery } from '../deliveries/entities/delivery.entity';
import { FuelPrice } from '../fuel-prices/entities/fuel-price.entity';
import { FuelOrderItem } from '../fuel-orders/entities/fuel-order-item.entity';
import { FuelOrder } from '../fuel-orders/entities/fuel-order.entity';
import { FuelType } from '../fuel-types/entities/fuel-type.entity';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity';
import { IncidentReport } from '../incidents/entities/incident-report.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { PasswordResetToken } from '../users/entities/password-reset-token.entity';
import { RefreshToken } from '../users/entities/refresh-token.entity';
import { Sale } from '../sales/entities/sale.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Tanker } from '../tankers/entities/tanker.entity';
import { User } from '../users/entities/user.entity';

export const ENTITIES = [
  Business,
  Branch,
  User,
  RefreshToken,
  PasswordResetToken,
  FuelType,
  FuelPrice,
  Supplier,
  Tanker,
  FuelOrder,
  FuelOrderItem,
  Delivery,
  DeliveryItem,
  InventoryTransaction,
  Sale,
  DailyReport,
  IncidentReport,
  Notification,
  AuditLog,
  IdempotencyKey,
];

export {
  AuditLog,
  Branch,
  Business,
  DailyReport,
  Delivery,
  DeliveryItem,
  FuelOrder,
  FuelOrderItem,
  FuelPrice,
  FuelType,
  IdempotencyKey,
  IncidentReport,
  InventoryTransaction,
  Notification,
  PasswordResetToken,
  RefreshToken,
  Sale,
  Supplier,
  Tanker,
  User,
};
