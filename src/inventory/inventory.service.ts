import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InventoryReferenceType, InventoryTransactionType } from '../common/enums/fuel.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { Decimal, DecimalMath } from '../common/utils/money.util';
import { resolveDateRange } from '../common/utils/date.util';
import { BranchesService } from '../branches/branches.service';
import { FuelTypesService } from '../fuel-types/fuel-types.service';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import {
  CreateAdjustmentDto,
  ListInventoryQueryDto,
  ListInventoryTransactionsQueryDto,
} from './dto/inventory.dto';
import {
  InventoryStockDto,
  InventorySummaryDto,
  InventorySummaryFuelDto,
  InventoryTransactionResponseDto,
} from './dto/inventory-response.dto';
import { stockLockKey } from './stock-lock.util';

export interface LedgerPosting {
  businessId: string;
  branchId: string;
  fuelTypeId: string;
  transactionType: InventoryTransactionType;
  /** Signed litres: positive adds stock, negative removes it. */
  quantityLitres: string;
  referenceType: string;
  referenceId: string | null;
  occurredAt: Date;
  createdBy: string | null;
  notes?: string | null;
  /**
   * Reject a posting that would drive the bucket below zero. Sales and negative
   * adjustments need this; a delivery does not, because it only ever adds.
   */
  forbidNegative?: boolean;
}

/**
 * The inventory ledger.
 *
 * Two rules shape everything here:
 *
 * 1. There is no mutable stock column anywhere. Current stock is always
 *    SUM(quantity_litres) and `balance_after` is a display snapshot only
 *    (docs/03 §74, §92).
 * 2. Rows are append-only. A mistake is fixed with a CORRECTION row, never an
 *    UPDATE or DELETE (docs/03 §49).
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly repository: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly branches: BranchesService,
    private readonly fuelTypes: FuelTypesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  /**
   * THE authoritative stock figure (docs/03 §74):
   *   COALESCE(SUM(quantity_litres), 0) over the ledger.
   */
  async currentStock(
    branchId: string,
    fuelTypeId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const repository = manager ? manager.getRepository(InventoryTransaction) : this.repository;

    const raw = await repository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.quantity_litres), 0)', 'total')
      .where('tx.branch_id = :branchId', { branchId })
      .andWhere('tx.fuel_type_id = :fuelTypeId', { fuelTypeId })
      .getRawOne<{ total: string }>();

    return this.normaliseQuantity(raw?.total ?? '0');
  }

  /**
   * Takes the transaction-level advisory lock for one (branch, fuel type)
   * bucket.
   *
   * This closes a gap the docs leave open: stock is an aggregate, and
   * PostgreSQL cannot row-lock an aggregate, so with no stock table there is
   * nothing to `SELECT ... FOR UPDATE` (docs/03 §73, §92). A key derived from
   * the branch+fuel pair serialises every read-modify-write of that bucket, so
   * two concurrent sales cannot both read the same pre-sale balance. The lock is
   * released automatically at commit or rollback.
   */
  async lockStock(branchId: string, fuelTypeId: string, manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [
      stockLockKey(branchId, fuelTypeId).toString(),
    ]);
  }

  /**
   * Appends one immutable ledger row.
   *
   * The caller owns the transaction; this never opens one of its own, so a sale
   * or a delivery receiving and its ledger rows commit or roll back together
   * (docs/05 §108).
   */
  async post(posting: LedgerPosting, manager: EntityManager): Promise<InventoryTransaction> {
    const repository = manager.getRepository(InventoryTransaction);

    // Serialise this bucket *before* reading the running balance.
    await this.lockStock(posting.branchId, posting.fuelTypeId, manager);

    const before = await this.currentStock(posting.branchId, posting.fuelTypeId, manager);
    const balanceAfter = DecimalMath.add(
      DecimalMath.parse(before),
      DecimalMath.parse(posting.quantityLitres),
    );

    if (posting.forbidNegative && DecimalMath.isNegative(balanceAfter)) {
      throw apiError(
        ErrorCode.INSUFFICIENT_INVENTORY,
        'That movement would take the available stock below zero.',
      );
    }

    return repository.save(
      repository.create({
        businessId: posting.businessId,
        branchId: posting.branchId,
        fuelTypeId: posting.fuelTypeId,
        transactionType: posting.transactionType,
        quantityLitres: this.normaliseQuantity(posting.quantityLitres),
        balanceAfter: this.normaliseQuantity(balanceAfter),
        referenceType: posting.referenceType,
        referenceId: posting.referenceId,
        occurredAt: posting.occurredAt,
        createdBy: posting.createdBy,
        notes: posting.notes ?? null,
      }),
    );
  }

  /**
   * GET /inventory — current stock per (branch, fuel type).
   *
   * Cross-joined in SQL from branches × fuel types with a correlated ledger sum,
   * so a branch holding zero of a grade still appears with 0 rather than
   * disappearing from the grid.
   */
  async currentStockMatrix(
    query: ListInventoryQueryDto,
    actor: AuthenticatedUser,
  ): Promise<InventoryStockDto[]> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    if (!businessId) return [];

    // A MANAGER is pinned to their own branch whatever filter they sent.
    const branchId = this.authorization.resolveBranchScope(actor, query.branchId);

    const builder = this.repository.manager
      .createQueryBuilder()
      .select('branch.id', 'branchId')
      .addSelect('branch.name', 'branchName')
      .addSelect('fuelType.id', 'fuelTypeId')
      .addSelect('fuelType.name', 'fuelTypeName')
      .addSelect(
        'COALESCE((SELECT SUM(tx.quantity_litres) FROM inventory_transactions tx ' +
          'WHERE tx.branch_id = branch.id AND tx.fuel_type_id = fuelType.id), 0)',
        'currentQuantityLitres',
      )
      .from('branches', 'branch')
      .innerJoin('fuel_types', 'fuelType', 'fuelType.business_id = branch.business_id')
      .where('branch.deleted_at IS NULL')
      .andWhere('fuelType.deleted_at IS NULL')
      .andWhere('branch.business_id = :businessId', { businessId });

    if (branchId) builder.andWhere('branch.id = :branchId', { branchId });
    if (query.fuelTypeId) {
      builder.andWhere('fuelType.id = :fuelTypeId', { fuelTypeId: query.fuelTypeId });
    }

    builder.orderBy('branch.name', 'ASC').addOrderBy('fuelType.name', 'ASC');

    const rows = await builder.getRawMany<{
      branchId: string;
      branchName: string;
      fuelTypeId: string;
      fuelTypeName: string;
      currentQuantityLitres: string;
    }>();

    return rows.map((row) => ({
      branchId: row.branchId,
      branchName: row.branchName,
      fuelTypeId: row.fuelTypeId,
      fuelTypeName: row.fuelTypeName,
      currentQuantityLitres: this.normaliseQuantity(row.currentQuantityLitres),
    }));
  }

  /** Business-wide totals when no branch is selected, per-fuel rows otherwise. */
  async summary(branchId: string | null, actor: AuthenticatedUser): Promise<InventorySummaryDto> {
    const effectiveBranchId = this.authorization.resolveBranchScope(actor, branchId);
    const rows = await this.currentStockMatrix(
      effectiveBranchId ? { branchId: effectiveBranchId } : {},
      actor,
    );

    const totals = new Map<string, { name: string; value: Decimal }>();
    for (const row of rows) {
      const existing = totals.get(row.fuelTypeId);
      const value = DecimalMath.parse(row.currentQuantityLitres);
      totals.set(row.fuelTypeId, {
        name: existing?.name ?? row.fuelTypeName,
        value: existing ? DecimalMath.add(existing.value, value) : value,
      });
    }

    const fuel: InventorySummaryFuelDto[] = [...totals.entries()].map(([fuelTypeId, entry]) => ({
      fuelTypeId,
      fuelType: entry.name,
      currentQuantityLitres: this.normaliseQuantity(entry.value),
    }));

    return { branchId: effectiveBranchId, asOf: new Date(), fuel };
  }

  async findTransactions(
    query: ListInventoryTransactionsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<InventoryTransactionResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    const forcedBranchId = this.authorization.resolveBranchScope(actor, query.branchId);

    const builder = this.repository
      .createQueryBuilder('tx')
      .where('1 = 1')
      .orderBy('tx.occurred_at', 'DESC')
      .addOrderBy('tx.created_at', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('tx.business_id = :businessId', { businessId });
    if (forcedBranchId) builder.andWhere('tx.branch_id = :forcedBranchId', { forcedBranchId });
    if (query.fuelTypeId) {
      builder.andWhere('tx.fuel_type_id = :fuelTypeId', { fuelTypeId: query.fuelTypeId });
    }
    if (query.type) builder.andWhere('tx.transaction_type = :type', { type: query.type });

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('tx.occurred_at <= :rangeEnd', { rangeEnd: range.end })
        .andWhere('tx.occurred_at >= :rangeStart', { rangeStart: range.start });
    }

    const [items, total] = await builder.getManyAndCount();

    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  /**
   * Manual adjustment: appends one ADJUSTMENT row carrying the caller's reason.
   * Historical rows are never touched (docs/04 §57).
   */
  async adjust(
    dto: CreateAdjustmentDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<InventoryTransaction> {
    const businessId = actor.businessId;
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    if (DecimalMath.isZero(DecimalMath.parse(dto.quantityLitres))) {
      throw invalidOperation('An adjustment of zero litres has no effect.');
    }

    return this.dataSource.transaction(async (manager) => {
      await this.branches.requireBranchInBusiness(dto.branchId, businessId);
      await this.fuelTypes.requireUsableFuelType(dto.fuelTypeId, businessId, manager);

      const quantityLitres = this.normaliseQuantity(dto.quantityLitres);

      const row = await this.post(
        {
          businessId,
          branchId: dto.branchId,
          fuelTypeId: dto.fuelTypeId,
          transactionType: InventoryTransactionType.ADJUSTMENT,
          quantityLitres,
          referenceType: InventoryReferenceType.ADJUSTMENT,
          referenceId: null,
          occurredAt: new Date(),
          createdBy: actor.id,
          notes: dto.reason.trim(),
          forbidNegative: true,
        },
        manager,
      );

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: dto.branchId },
        {
          action: AuditAction.INVENTORY_ADJUSTED,
          resourceType: AuditResourceType.INVENTORY,
          resourceId: row.id,
          metadata: {
            fuelTypeId: dto.fuelTypeId,
            quantityLitres,
            reason: dto.reason.trim(),
          },
        },
        manager,
      );

      return row;
    });
  }

  toResponse(row: InventoryTransaction): InventoryTransactionResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      fuelTypeId: row.fuelTypeId,
      transactionType: row.transactionType,
      quantityLitres: row.quantityLitres,
      balanceAfter: row.balanceAfter,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      occurredAt: row.occurredAt,
      reason: row.notes,
    };
  }

  /** Normalises any numeric input to the ledger's NUMERIC(18,3) string form. */
  normaliseQuantity(value: string | number | Decimal): string {
    const decimal = typeof value === 'object' ? value : DecimalMath.parse(value);
    return DecimalMath.toFixedString(
      DecimalMath.rescale(decimal, DecimalMath.QUANTITY_SCALE),
      DecimalMath.QUANTITY_SCALE,
    );
  }

  /** Ledger movement for one branch over a half-open UTC window. */
  async sumBetween(
    branchId: string,
    start: Date,
    end: Date,
    fuelTypeId?: string | null,
    manager?: EntityManager,
  ): Promise<string> {
    const repository = manager ? manager.getRepository(InventoryTransaction) : this.repository;

    const builder = repository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.quantity_litres), 0)', 'total')
      .where('tx.branch_id = :branchId', { branchId })
      .andWhere('tx.occurred_at >= :start', { start })
      .andWhere('tx.occurred_at < :end', { end });

    if (fuelTypeId) builder.andWhere('tx.fuel_type_id = :fuelTypeId', { fuelTypeId });

    const raw = await builder.getRawOne<{ total: string }>();
    return this.normaliseQuantity(raw?.total ?? '0');
  }

  /** Signed sum of one transaction type over a window, grouped by fuel type. */
  async sumByTypeBetween(
    branchId: string,
    type: InventoryTransactionType,
    start: Date,
    end: Date,
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const repository = manager ? manager.getRepository(InventoryTransaction) : this.repository;

    const rows = await repository
      .createQueryBuilder('tx')
      .select('tx.fuel_type_id', 'fuelTypeId')
      .addSelect('COALESCE(SUM(tx.quantity_litres), 0)', 'total')
      .where('tx.branch_id = :branchId', { branchId })
      .andWhere('tx.transaction_type = :type', { type })
      .andWhere('tx.occurred_at >= :start', { start })
      .andWhere('tx.occurred_at < :end', { end })
      .groupBy('tx.fuel_type_id')
      .getRawMany<{ fuelTypeId: string; total: string }>();

    return new Map(rows.map((row) => [row.fuelTypeId, this.normaliseQuantity(row.total)]));
  }
}
