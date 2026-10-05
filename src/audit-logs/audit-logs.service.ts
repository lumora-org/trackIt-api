import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditActor {
  userId?: string | null;
  role?: string | null;
  businessId?: string | null;
  branchId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  businessId?: string | null;
  branchId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Canonical audit action values (PROMPT-B.E §4.16). Kept as a union so a typo
 * cannot silently create a new, unfilterable action.
 */
export const AuditAction = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  PASSWORD_RESET: 'PASSWORD_RESET',

  BUSINESS_CREATED: 'BUSINESS_CREATED',
  BUSINESS_UPDATED: 'BUSINESS_UPDATED',

  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',

  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',

  FUEL_TYPE_CREATED: 'FUEL_TYPE_CREATED',
  FUEL_TYPE_UPDATED: 'FUEL_TYPE_UPDATED',

  FUEL_PRICE_CREATED: 'FUEL_PRICE_CREATED',

  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER_UPDATED',

  TANKER_CREATED: 'TANKER_CREATED',
  TANKER_UPDATED: 'TANKER_UPDATED',

  FUEL_ORDER_CREATED: 'FUEL_ORDER_CREATED',
  FUEL_ORDER_SUBMITTED: 'FUEL_ORDER_SUBMITTED',
  FUEL_ORDER_CONFIRMED: 'FUEL_ORDER_CONFIRMED',
  FUEL_ORDER_CANCELLED: 'FUEL_ORDER_CANCELLED',

  DELIVERY_CREATED: 'DELIVERY_CREATED',
  DELIVERY_RECEIVED: 'DELIVERY_RECEIVED',
  DELIVERY_DISPUTED: 'DELIVERY_DISPUTED',

  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  INVENTORY_CORRECTED: 'INVENTORY_CORRECTED',

  SALE_CREATED: 'SALE_CREATED',
  SALE_VOIDED: 'SALE_VOIDED',

  DAILY_REPORT_CREATED: 'DAILY_REPORT_CREATED',
  DAILY_REPORT_SUBMITTED: 'DAILY_REPORT_SUBMITTED',
  DAILY_REPORT_APPROVED: 'DAILY_REPORT_APPROVED',
  DAILY_REPORT_REJECTED: 'DAILY_REPORT_REJECTED',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResourceType = {
  AUTH: 'AUTH',
  BUSINESS: 'BUSINESS',
  BRANCH: 'BRANCH',
  USER: 'USER',
  FUEL_TYPE: 'FUEL_TYPE',
  FUEL_PRICE: 'FUEL_PRICE',
  SUPPLIER: 'SUPPLIER',
  TANKER: 'TANKER',
  FUEL_ORDER: 'FUEL_ORDER',
  DELIVERY: 'DELIVERY',
  INVENTORY: 'INVENTORY',
  SALE: 'SALE',
  DAILY_REPORT: 'DAILY_REPORT',
} as const;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  /**
   * Writes one audit row. Pass the transaction `manager` so the audit entry
   * commits atomically with the business change it describes — critical domain
   * actions must not rely on generic HTTP interception (docs/05 §65).
   *
   * The audit row is deliberately never updated or deleted afterwards.
   */
  async record(
    actor: AuditActor,
    entry: AuditEntry,
    manager?: EntityManager,
  ): Promise<AuditLog | null> {
    const repository = manager ? manager.getRepository(AuditLog) : this.repository;

    const row = repository.create({
      userId: actor.userId ?? null,
      businessId: entry.businessId ?? actor.businessId ?? null,
      branchId: entry.branchId ?? actor.branchId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
    });

    try {
      return await repository.save(row);
    } catch (error) {
      // An audit write failure must never take down the business operation,
      // but it must be loud.
      this.logger.error(`Failed to persist audit entry ${entry.action}`, error as Error);
      return null;
    }
  }

  async recordMany(
    actor: AuditActor,
    entries: AuditEntry[],
    manager?: EntityManager,
  ): Promise<void> {
    for (const entry of entries) {
      await this.record(actor, entry, manager);
    }
  }
}
