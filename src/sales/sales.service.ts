import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  InventoryReferenceType,
  InventoryTransactionType,
  SaleApprovalStatus,
  SaleRecordMode,
} from '../common/enums/fuel.enum';
import { NotificationType } from '../common/enums/notification.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { DecimalMath } from '../common/utils/money.util';
import {
  endOfDayInTimeZone,
  isBareDate,
  resolveDateRange,
  startOfDayInTimeZone,
  toDateOnlyInTimeZone,
} from '../common/utils/date.util';
import { BranchesService } from '../branches/branches.service';
import { FuelTypesService } from '../fuel-types/fuel-types.service';
import { FuelPricesService } from '../fuel-prices/fuel-prices.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationRequest, NotificationsService } from '../notifications/notifications.service';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { Sale } from './entities/sale.entity';
import {
  CreateSaleDto,
  ListSalesQueryDto,
  RecordDayTotalDto,
  RejectSaleDto,
  VoidSaleDto,
} from './dto/sale.dto';
import { SaleResponseDto } from './dto/sale-response.dto';

/**
 * Sales is where pricing, revenue and inventory meet. Three rules hold
 * throughout:
 *
 * 1. The client never prices anything. unitPrice is resolved from the price
 *    interval in force at the moment of recording and then snapshotted onto
 *    the row, so a later price change can never rewrite historical revenue
 *    (docs/08 §30).
 * 2. A sale and its inventory row are created in the SAME transaction. A sale
 *    without a ledger row would desynchronise stock from reality permanently.
 * 3. Sales are voided, never deleted, and a void restores stock with a
 *    CORRECTION row rather than an edit (docs/03 §62).
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectRepository(Sale)
    private readonly repository: Repository<Sale>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly branches: BranchesService,
    private readonly fuelTypes: FuelTypesService,
    private readonly fuelPrices: FuelPricesService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(sale: Sale): SaleResponseDto {
    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      branchId: sale.branchId,
      fuelTypeId: sale.fuelTypeId,
      fuelTypeName: sale.fuelType?.name,
      litresSold: sale.litresSold,
      unitPrice: sale.unitPrice,
      totalAmount: sale.totalAmount,
      recordMode: sale.recordMode,
      approvalStatus: sale.approvalStatus,
      approvedAt: sale.approvedAt,
      rejectionReason: sale.rejectionReason,
      soldAt: sale.soldAt,
      voidedAt: sale.voidedAt,
      voidReason: sale.voidReason,
    };
  }

  async findAll(
    query: ListSalesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<SaleResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    // A MANAGER is pinned to their own branch whatever they asked for.
    const forcedBranchId = this.authorization.resolveBranchScope(actor, query.branchId);

    const builder = this.repository
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.fuelType', 'fuelType')
      .where('1 = 1')
      // Property path, not the DB column name: skip/take + joins makes TypeORM
      // resolve order criteria through entity metadata (see deliveries findAll).
      // `id` last: sales stamped in one transaction share sold_at, and an
      // unresolved tie makes a row appear on two pages or on none.
      .orderBy('sale.soldAt', 'DESC')
      .addOrderBy('sale.id', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('sale.business_id = :businessId', { businessId });
    if (forcedBranchId) builder.andWhere('sale.branch_id = :forcedBranchId', { forcedBranchId });
    if (query.fuelTypeId) {
      builder.andWhere('sale.fuel_type_id = :fuelTypeId', { fuelTypeId: query.fuelTypeId });
    }
    if (query.recordMode) {
      builder.andWhere('sale.record_mode = :recordMode', { recordMode: query.recordMode });
    }
    if (query.approvalStatus) {
      builder.andWhere('sale.approval_status = :approvalStatus', {
        approvalStatus: query.approvalStatus,
      });
    }

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('sale.sold_at <= :rangeEnd', { rangeEnd: range.end })
        .andWhere('sale.sold_at >= :rangeStart', { rangeStart: range.start });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Sale> {
    const sale = await this.repository.findOne({
      where: { id },
      relations: { fuelType: true },
    });

    if (!sale) throw notFound('The requested sale was not found.');

    // Fetching by id alone would be an IDOR: ownership is checked here, not in
    // the query, so the branch/business scope cannot be skipped (docs/06 §25).
    if (!this.authorization.managesBusiness(actor, sale.businessId)) {
      throw notFound('The requested sale was not found.');
    }

    this.authorization.assertBranchAccess(actor, sale.branchId);

    return sale;
  }

  /**
   * Records a sale.
   *
   * BEGIN
   *   lock inventory, read available stock
   *   resolve the price applicable at soldAt
   *   total = litresSold x unitPrice        (exact decimal, never float)
   *   insert the sale
   *   insert the negative SALE ledger row
   *   audit
   * COMMIT
   *
   * The stock lock is taken by InventoryService.post, so the check and the write
   * cannot be interleaved with a concurrent sale on the same bucket.
   */
  async create(
    dto: CreateSaleDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<SaleResponseDto> {
    const businessId = actor.businessId;
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    const soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();
    if (Number.isNaN(soldAt.getTime())) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'soldAt must be a valid ISO 8601 timestamp.');
    }

    const litresSold = this.inventory.normaliseQuantity(dto.litresSold);

    const saved = await this.dataSource.transaction(async (manager) => {
      const branch = await this.branches.requireBranchInBusiness(dto.branchId, businessId);
      const fuelType = await this.fuelTypes.requireUsableFuelType(
        dto.fuelTypeId,
        businessId,
        manager,
      );

      // The backend prices the sale. A missing interval is a 422
      // INVALID_FUEL_PRICE, never a default or a client-supplied figure.
      const price = await this.fuelPrices.getApplicablePrice(
        businessId,
        dto.fuelTypeId,
        soldAt,
        manager,
      );

      const unitPrice = DecimalMath.toFixedString(
        DecimalMath.rescale(DecimalMath.parse(price.pricePerLitre), DecimalMath.MONEY_SCALE),
        DecimalMath.MONEY_SCALE,
      );

      const totalAmount = DecimalMath.lineTotal(litresSold, unitPrice);

      const repository = manager.getRepository(Sale);

      const sale = repository.create({
        businessId,
        saleNumber: await this.nextSaleNumber(businessId, manager),
        branchId: dto.branchId,
        fuelTypeId: dto.fuelTypeId,
        litresSold,
        unitPrice,
        totalAmount,
        soldAt,
        // A manager's recording awaits confirmation; an admin's is confirmed
        // by definition (product decision, 2026-10).
        ...this.approvalStamp(actor),
        recordedBy: actor.id,
        voidedAt: null,
        voidReason: null,
        voidedBy: null,
      });

      const persisted = await repository.save(sale);

      // Negative SALE row. forbidNegative makes an oversell a 422 rather than a
      // silent negative balance (docs/03 §73).
      await this.inventory.post(
        {
          businessId,
          branchId: dto.branchId,
          fuelTypeId: dto.fuelTypeId,
          transactionType: InventoryTransactionType.SALE,
          quantityLitres: this.negateQuantity(litresSold),
          referenceType: InventoryReferenceType.SALE,
          referenceId: persisted.id,
          occurredAt: soldAt,
          createdBy: actor.id,
          notes: null,
          forbidNegative: true,
        },
        manager,
      );

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: dto.branchId },
        {
          action: AuditAction.SALE_CREATED,
          resourceType: AuditResourceType.SALE,
          resourceId: persisted.id,
          newValues: {
            saleNumber: persisted.saleNumber,
            litresSold,
            unitPrice,
            totalAmount,
            fuelTypeCode: fuelType.code,
          },
        },
        manager,
      );

      // Head office sees takings as they land: every recorded sale alerts the
      // business's admins, committed with the sale itself (product decision,
      // 2026-10).
      await this.notifyAdminsOfSale(
        businessId,
        `Sale recorded: ${persisted.saleNumber}`,
        `${actor.firstName} ${actor.lastName} recorded ${litresSold} L of ${fuelType.code} at ${branch.name} for ${totalAmount}.`,
        persisted.id,
        manager,
      );

      return repository.findOneOrFail({
        where: { id: persisted.id },
        relations: { fuelType: true },
      });
    });

    this.logger.log(
      `Sale ${saved.saleNumber} recorded: ${saved.litresSold} L at ${saved.unitPrice} = ${saved.totalAmount}`,
    );

    return this.toResponse(saved);
  }

  /**
   * Records (or corrects) the branch's total litres sold for one fuel on one
   * business day — the manager's end-of-day figure rather than a single
   * counter transaction (product decision, 2026-10).
   *
   * The row is keyed by (branch, fuel, business day): the manager revises the
   * same figure as the day goes on, and the ledger only ever moves by the
   * DELTA between the previous and the new total, so stock stays exact without
   * re-booking the whole day:
   *
   *   increase -> a SALE row for the added litres
   *   decrease -> a CORRECTION row restoring the removed litres
   *   zero     -> the day's row is voided and the whole quantity restored
   *
   * soldAt is pinned to noon of the target business day, so a correction
   * entered the next morning still belongs to the day it describes. Pricing
   * follows the clock rather than the calendar: the whole figure is (re)valued
   * at the interval in force at the moment of recording — never a weighted
   * average of the day's intervals — so the row always balances exactly as
   * litres x the admin's current price (product decision, 2026-10).
   *
   * BEGIN
   *   advisory lock on (business, branch, fuel, day)
   *   read the day's row (if any)
   *   insert / adjust / void + delta ledger row
   *   audit
   * COMMIT
   */
  async recordDayTotal(
    dto: RecordDayTotalDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<SaleResponseDto | null> {
    const businessId = actor.businessId;
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    const today = toDateOnlyInTimeZone(new Date(), this.businessTimezone);
    const date = dto.date ?? today;
    if (!isBareDate(date)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'date must be a calendar date (YYYY-MM-DD).');
    }
    if (date > today) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'Sales cannot be recorded for a future date.');
    }

    const dayStart = startOfDayInTimeZone(date, this.businessTimezone);
    const dayEnd = endOfDayInTimeZone(date, this.businessTimezone);
    // Noon pins the row inside its business day whatever the offset between
    // server and business time, so a correction entered later still groups
    // under the day it describes.
    const soldAt = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);

    const totalLitres = this.inventory.normaliseQuantity(dto.totalLitres);

    const saved = await this.dataSource.transaction(async (manager) => {
      const branch = await this.branches.requireBranchInBusiness(dto.branchId, businessId);
      this.authorization.assertBranchAccess(actor, dto.branchId);
      const fuelType = await this.fuelTypes.requireUsableFuelType(
        dto.fuelTypeId,
        businessId,
        manager,
      );

      // Serialise concurrent recordings for the same branch/fuel/day. The
      // partial unique index would reject a second insert, but an
      // interleaved read-modify-write could still lose a correction.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `day-total:${businessId}:${dto.branchId}:${dto.fuelTypeId}:${date}`,
      ]);

      const repository = manager.getRepository(Sale);

      const existing = await repository
        .createQueryBuilder('sale')
        // Lock only the sale row: PostgreSQL refuses FOR UPDATE on the
        // nullable side of the fuel type outer join.
        .setLock('pessimistic_write', undefined, ['sale'])
        .leftJoinAndSelect('sale.fuelType', 'fuelType')
        .where('sale.branch_id = :branchId', { branchId: dto.branchId })
        .andWhere('sale.fuel_type_id = :fuelTypeId', { fuelTypeId: dto.fuelTypeId })
        .andWhere('sale.record_mode = :recordMode', { recordMode: SaleRecordMode.DAY_TOTAL })
        .andWhere('sale.voided_at IS NULL')
        .andWhere('sale.sold_at >= :dayStart', { dayStart })
        .andWhere('sale.sold_at < :dayEnd', { dayEnd })
        .getOne();

      if (!existing) {
        // An explicit zero for a day with nothing recorded is a no-op: there
        // is nothing to restore, and sales_litres_sold_positive forbids a
        // zero row anyway.
        if (DecimalMath.isZero(DecimalMath.parse(totalLitres))) return null;

        // Priced at the interval in force NOW, never at the pinned noon
        // instant: a price change made at any point in the day must apply to
        // everything recorded afterwards (product decision, 2026-10).
        const price = await this.fuelPrices.getApplicablePrice(
          businessId,
          dto.fuelTypeId,
          new Date(),
          manager,
        );
        const unitPrice = DecimalMath.toFixedString(
          DecimalMath.rescale(DecimalMath.parse(price.pricePerLitre), DecimalMath.MONEY_SCALE),
          DecimalMath.MONEY_SCALE,
        );
        const totalAmount = DecimalMath.lineTotal(totalLitres, unitPrice);

        const sale = repository.create({
          businessId,
          saleNumber: await this.nextSaleNumber(businessId, manager),
          branchId: dto.branchId,
          fuelTypeId: dto.fuelTypeId,
          litresSold: totalLitres,
          unitPrice,
          totalAmount,
          soldAt,
          recordMode: SaleRecordMode.DAY_TOTAL,
          // A manager's recording awaits confirmation; an admin's is confirmed
          // by definition (product decision, 2026-10).
          ...this.approvalStamp(actor),
          recordedBy: actor.id,
          voidedAt: null,
          voidReason: null,
          voidedBy: null,
        });

        const persisted = await repository.save(sale);

        await this.inventory.post(
          {
            businessId,
            branchId: dto.branchId,
            fuelTypeId: dto.fuelTypeId,
            transactionType: InventoryTransactionType.SALE,
            quantityLitres: this.negateQuantity(totalLitres),
            referenceType: InventoryReferenceType.SALE,
            referenceId: persisted.id,
            occurredAt: soldAt,
            createdBy: actor.id,
            notes: null,
            forbidNegative: true,
          },
          manager,
        );

        await this.audit.record(
          { ...auditActor, userId: actor.id, businessId, branchId: dto.branchId },
          {
            action: AuditAction.SALE_DAY_TOTAL_RECORDED,
            resourceType: AuditResourceType.SALE,
            resourceId: persisted.id,
            newValues: { date, litresSold: totalLitres, unitPrice, totalAmount },
          },
          manager,
        );

        await this.notifyAdminsOfSale(
          businessId,
          `Day total recorded: ${persisted.saleNumber}`,
          `${actor.firstName} ${actor.lastName} recorded ${totalLitres} L of ${fuelType.code} at ${branch.name} for ${totalAmount} (${date}).`,
          persisted.id,
          manager,
        );

        return repository.findOneOrFail({
          where: { id: persisted.id },
          relations: { fuelType: true },
        });
      }

      const previousLitres = existing.litresSold;
      const delta = DecimalMath.subtract(
        DecimalMath.parse(totalLitres),
        DecimalMath.parse(previousLitres),
      );

      // An unchanged figure is a no-op, not an error: the UI re-saves freely.
      if (DecimalMath.isZero(delta)) return existing;

      if (DecimalMath.isZero(DecimalMath.parse(totalLitres))) {
        // Clearing the day: void the row and restore everything it booked.
        existing.voidedAt = new Date();
        existing.voidReason = `Day total cleared for ${date}`;
        existing.voidedBy = actor.id;
        await repository.save(existing);

        await this.inventory.post(
          {
            businessId,
            branchId: existing.branchId,
            fuelTypeId: existing.fuelTypeId,
            transactionType: InventoryTransactionType.CORRECTION,
            quantityLitres: this.inventory.normaliseQuantity(previousLitres),
            referenceType: InventoryReferenceType.SALE,
            referenceId: existing.id,
            occurredAt: new Date(),
            createdBy: actor.id,
            notes: `Day total cleared for ${date}`,
          },
          manager,
        );

        await this.audit.record(
          { ...auditActor, userId: actor.id, businessId, branchId: existing.branchId },
          {
            action: AuditAction.SALE_DAY_TOTAL_CORRECTED,
            resourceType: AuditResourceType.SALE,
            resourceId: existing.id,
            oldValues: { litresSold: previousLitres, totalAmount: existing.totalAmount },
            newValues: { litresSold: '0.000', voided: true, date },
          },
          manager,
        );

        await this.notifyAdminsOfSale(
          businessId,
          `Day total cleared: ${existing.saleNumber}`,
          `${actor.firstName} ${actor.lastName} cleared the ${fuelType.code} day total at ${branch.name} for ${date}; ${previousLitres} L returned to stock.`,
          existing.id,
          manager,
        );

        return null;
      }

      // The whole day figure is (re)valued at the price in force NOW — never
      // a weighted average of the day's intervals. The manager's total
      // describes today, and the row must balance exactly as litres x the
      // admin's current price (product decision, 2026-10). The ledger still
      // moves only the delta between the previous and the new figure, so
      // stock stays exact without re-booking the day.
      const price = await this.fuelPrices.getApplicablePrice(
        businessId,
        dto.fuelTypeId,
        new Date(),
        manager,
      );
      const newUnitPrice = DecimalMath.toFixedString(
        DecimalMath.rescale(DecimalMath.parse(price.pricePerLitre), DecimalMath.MONEY_SCALE),
        DecimalMath.MONEY_SCALE,
      );
      const newTotalAmount = DecimalMath.lineTotal(totalLitres, newUnitPrice);

      let ledgerQuantity: string;
      let ledgerType: InventoryTransactionType;

      if (DecimalMath.isNegative(delta)) {
        // Removed litres return to stock with a CORRECTION row.
        ledgerQuantity = this.inventory.normaliseQuantity(DecimalMath.negate(delta));
        ledgerType = InventoryTransactionType.CORRECTION;
      } else {
        // Added litres book a SALE row for the delta only.
        ledgerQuantity = this.inventory.normaliseQuantity(delta);
        ledgerType = InventoryTransactionType.SALE;
      }

      // A revision always re-opens the confirmation gate: the manager's new
      // figure is unconfirmed until an admin signs it off again (an admin's
      // own revision is a confirmation by definition).
      const approval = this.approvalStamp(actor);

      existing.litresSold = totalLitres;
      existing.unitPrice = newUnitPrice;
      existing.totalAmount = newTotalAmount;
      existing.recordedBy = actor.id;
      existing.approvalStatus = approval.approvalStatus;
      existing.approvedBy = approval.approvedBy;
      existing.approvedAt = approval.approvedAt;
      existing.rejectionReason = null;
      await repository.save(existing);

      await this.inventory.post(
        {
          businessId,
          branchId: existing.branchId,
          fuelTypeId: existing.fuelTypeId,
          transactionType: ledgerType,
          // SALE rows are negative; a CORRECTION restores stock positively.
          quantityLitres:
            ledgerType === InventoryTransactionType.SALE
              ? this.negateQuantity(ledgerQuantity)
              : ledgerQuantity,
          referenceType: InventoryReferenceType.SALE,
          referenceId: existing.id,
          occurredAt: new Date(),
          createdBy: actor.id,
          notes: `Day total revised for ${date}: ${previousLitres} L -> ${totalLitres} L`,
          // An increase can oversell and must fail loudly; a decrease only
          // returns stock and can never go negative.
          forbidNegative: ledgerType === InventoryTransactionType.SALE,
        },
        manager,
      );

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: existing.branchId },
        {
          action: AuditAction.SALE_DAY_TOTAL_CORRECTED,
          resourceType: AuditResourceType.SALE,
          resourceId: existing.id,
          oldValues: { litresSold: previousLitres },
          newValues: {
            litresSold: totalLitres,
            unitPrice: newUnitPrice,
            totalAmount: newTotalAmount,
          },
          metadata: { date, ledgerDelta: ledgerQuantity, ledgerType },
        },
        manager,
      );

      await this.notifyAdminsOfSale(
        businessId,
        `Day total revised: ${existing.saleNumber}`,
        `${actor.firstName} ${actor.lastName} revised the ${fuelType.code} day total at ${branch.name} for ${date}: ${previousLitres} L -> ${totalLitres} L (${newTotalAmount}).`,
        existing.id,
        manager,
      );

      return existing;
    });

    if (!saved) {
      this.logger.log(`Day total for ${date} left empty for branch ${dto.branchId}`);
      return null;
    }

    this.logger.log(
      `Day total for ${date} recorded: ${saved.litresSold} L at ${saved.unitPrice} = ${saved.totalAmount} (${saved.saleNumber})`,
    );

    return this.toResponse(saved);
  }

  /**
   * Voids a sale.
   *
   * The row is never deleted. Stock is restored with a CORRECTION row carrying
   * +litresSold, so the ledger keeps showing both the sale and its reversal
   * (docs/04 §63). Re-voiding is refused with 422 INVALID_OPERATION so a second
   * correction cannot be posted for the same sale.
   */
  async void(
    id: string,
    dto: VoidSaleDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<SaleResponseDto> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.voidedAt) {
      throw invalidOperation('This sale has already been voided.');
    }

    const businessId = existing.businessId;

    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Sale);

      const locked = await repository
        .createQueryBuilder('sale')
        // Lock only the sale row: PostgreSQL refuses FOR UPDATE on the
        // nullable side of the fuel type outer join.
        .setLock('pessimistic_write', undefined, ['sale'])
        .leftJoinAndSelect('sale.fuelType', 'fuelType')
        .where('sale.id = :id', { id })
        .getOneOrFail();

      if (locked.voidedAt) {
        throw invalidOperation('This sale has already been voided.');
      }

      locked.voidedAt = new Date();
      locked.voidReason = dto.reason.trim();
      locked.voidedBy = actor.id;
      await repository.save(locked);

      // Restore the litres with a CORRECTION, never by editing the SALE row.
      await this.inventory.post(
        {
          businessId,
          branchId: locked.branchId,
          fuelTypeId: locked.fuelTypeId,
          transactionType: InventoryTransactionType.CORRECTION,
          quantityLitres: this.inventory.normaliseQuantity(locked.litresSold),
          referenceType: InventoryReferenceType.SALE,
          referenceId: locked.id,
          occurredAt: new Date(),
          createdBy: actor.id,
          notes: `Void: ${dto.reason.trim()}`,
        },
        manager,
      );

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: locked.branchId },
        {
          action: AuditAction.SALE_VOIDED,
          resourceType: AuditResourceType.SALE,
          resourceId: locked.id,
          oldValues: { voidedAt: null },
          newValues: { voidedAt: locked.voidedAt, voidReason: locked.voidReason },
          metadata: { restoredLitres: locked.litresSold, totalAmount: locked.totalAmount },
        },
        manager,
      );

      return locked;
    });

    this.logger.log(`Sale ${updated.saleNumber} voided: ${updated.voidReason}`);

    return this.toResponse(updated);
  }

  /**
   * Confirms a manager-recorded figure (product decision, 2026-10).
   *
   * Approval is workflow metadata, never accounting: the litres and amount
   * already count in every aggregate whatever the status, so nothing
   * recomputes here — the stamp only tells the branch their figure was seen
   * and accepted. A REJECTED figure can also be approved, so an admin can
   * reverse a refusal without waiting for the manager's revision.
   *
   * BEGIN
   *   lock the sale row
   *   stamp APPROVED (approvedBy/approvedAt, clear any rejection reason)
   *   audit
   *   notify the recorder
   * COMMIT
   */
  async approve(
    id: string,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<SaleResponseDto> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.voidedAt) {
      throw invalidOperation('A voided sale cannot be approved.');
    }
    if (existing.approvalStatus === SaleApprovalStatus.APPROVED) {
      throw invalidOperation('This sale has already been approved.');
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Sale);

      const locked = await repository
        .createQueryBuilder('sale')
        // Lock only the sale row: PostgreSQL refuses FOR UPDATE on the
        // nullable side of the fuel type outer join.
        .setLock('pessimistic_write', undefined, ['sale'])
        .leftJoinAndSelect('sale.fuelType', 'fuelType')
        .where('sale.id = :id', { id })
        .getOneOrFail();

      // Re-check under the lock: the row may have been revised or voided
      // between the scope read and this transaction.
      if (locked.voidedAt) {
        throw invalidOperation('A voided sale cannot be approved.');
      }
      if (locked.approvalStatus === SaleApprovalStatus.APPROVED) {
        throw invalidOperation('This sale has already been approved.');
      }

      locked.approvalStatus = SaleApprovalStatus.APPROVED;
      locked.approvedBy = actor.id;
      locked.approvedAt = new Date();
      locked.rejectionReason = null;
      await repository.save(locked);

      await this.audit.record(
        {
          ...auditActor,
          userId: actor.id,
          businessId: locked.businessId,
          branchId: locked.branchId,
        },
        {
          action: AuditAction.SALE_APPROVED,
          resourceType: AuditResourceType.SALE,
          resourceId: locked.id,
          oldValues: { approvalStatus: existing.approvalStatus },
          newValues: { approvalStatus: SaleApprovalStatus.APPROVED },
          metadata: {
            saleNumber: locked.saleNumber,
            litresSold: locked.litresSold,
            totalAmount: locked.totalAmount,
          },
        },
        manager,
      );

      await this.notifyRecorderOfDecision(
        locked,
        {
          type: NotificationType.SALE_APPROVED,
          title: `Sale approved: ${locked.saleNumber}`,
          message: `Your figure of ${locked.litresSold} L of ${locked.fuelType?.code ?? 'fuel'} (${locked.totalAmount}) was approved by ${actor.firstName} ${actor.lastName}.`,
          resourceType: 'SALE',
          resourceId: locked.id,
        },
        manager,
      );

      return locked;
    });

    this.logger.log(`Sale ${updated.saleNumber} approved by ${actor.id}`);

    return this.toResponse(updated);
  }

  /**
   * Refuses a manager-recorded figure with a mandatory reason (product
   * decision, 2026-10). Only a figure still awaiting review can be refused: an
   * APPROVED row is corrected by voiding, and a REJECTED one is superseded by
   * the manager's revision (which re-opens the gate) or by an approval.
   *
   * The figures stay on the books exactly as recorded — rejection is a signal
   * to the branch, not an accounting event.
   */
  async reject(
    id: string,
    dto: RejectSaleDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<SaleResponseDto> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.voidedAt) {
      throw invalidOperation('A voided sale cannot be rejected.');
    }
    if (existing.approvalStatus !== SaleApprovalStatus.PENDING) {
      throw invalidOperation(
        existing.approvalStatus === SaleApprovalStatus.APPROVED
          ? 'This sale has already been approved; void it to reverse the figures.'
          : 'This sale has already been rejected.',
      );
    }

    const reason = dto.reason.trim();

    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Sale);

      const locked = await repository
        .createQueryBuilder('sale')
        // Lock only the sale row: PostgreSQL refuses FOR UPDATE on the
        // nullable side of the fuel type outer join.
        .setLock('pessimistic_write', undefined, ['sale'])
        .leftJoinAndSelect('sale.fuelType', 'fuelType')
        .where('sale.id = :id', { id })
        .getOneOrFail();

      // Re-check under the lock: the row may have been revised or voided
      // between the scope read and this transaction.
      if (locked.voidedAt) {
        throw invalidOperation('A voided sale cannot be rejected.');
      }
      if (locked.approvalStatus !== SaleApprovalStatus.PENDING) {
        throw invalidOperation('Only a sale awaiting review can be rejected.');
      }

      locked.approvalStatus = SaleApprovalStatus.REJECTED;
      locked.approvedBy = null;
      locked.approvedAt = null;
      locked.rejectionReason = reason;
      await repository.save(locked);

      await this.audit.record(
        {
          ...auditActor,
          userId: actor.id,
          businessId: locked.businessId,
          branchId: locked.branchId,
        },
        {
          action: AuditAction.SALE_REJECTED,
          resourceType: AuditResourceType.SALE,
          resourceId: locked.id,
          oldValues: { approvalStatus: SaleApprovalStatus.PENDING },
          newValues: { approvalStatus: SaleApprovalStatus.REJECTED, rejectionReason: reason },
          metadata: {
            saleNumber: locked.saleNumber,
            litresSold: locked.litresSold,
            totalAmount: locked.totalAmount,
          },
        },
        manager,
      );

      await this.notifyRecorderOfDecision(
        locked,
        {
          type: NotificationType.SALE_REJECTED,
          title: `Sale rejected: ${locked.saleNumber}`,
          message:
            `Your figure of ${locked.litresSold} L of ${locked.fuelType?.code ?? 'fuel'} was rejected by ` +
            `${actor.firstName} ${actor.lastName}: ${reason}` +
            (locked.recordMode === SaleRecordMode.DAY_TOTAL
              ? ' Revise the day total to submit a corrected figure.'
              : ' Contact an admin to void the sale if it must be reversed.'),
          resourceType: 'SALE',
          resourceId: locked.id,
        },
        manager,
      );

      return locked;
    });

    this.logger.log(`Sale ${updated.saleNumber} rejected by ${actor.id}: ${reason}`);

    return this.toResponse(updated);
  }

  /**
   * Aggregate revenue for dashboards and reports. Voided sales are always
   * excluded (docs/03 §57).
   */
  async summarise(
    branchId: string | null,
    start: Date | null,
    end: Date | null,
    manager?: EntityManager,
  ): Promise<{ litresSold: string; revenue: string }> {
    const repository = manager ? manager.getRepository(Sale) : this.repository;

    const builder = repository
      .createQueryBuilder('sale')
      .select('COALESCE(SUM(sale.litres_sold), 0)', 'litres')
      .addSelect('COALESCE(SUM(sale.total_amount), 0)', 'revenue')
      .where('sale.voided_at IS NULL');

    if (branchId) builder.andWhere('sale.branch_id = :branchId', { branchId });
    if (start) builder.andWhere('sale.sold_at >= :start', { start });
    if (end) builder.andWhere('sale.sold_at <= :end', { end });

    const raw = await builder.getRawOne<{ litres: string; revenue: string }>();

    return {
      litresSold: this.inventory.normaliseQuantity(raw?.litres ?? '0'),
      revenue: DecimalMath.toFixedString(
        DecimalMath.rescale(DecimalMath.parse(raw?.revenue ?? '0'), DecimalMath.MONEY_SCALE),
        DecimalMath.MONEY_SCALE,
      ),
    };
  }

  /**
   * Head office sees takings as they land: every recording — a single sale or
   * a day-total upsert — fans a SALE_RECORDED notification out to the
   * business's admins inside the same transaction, so the alert can never be
   * lost to a rollback (product decision, 2026-10).
   */
  private async notifyAdminsOfSale(
    businessId: string,
    title: string,
    message: string,
    resourceId: string,
    manager: EntityManager,
  ): Promise<void> {
    await this.notifications.notifyBusinessAdmins(
      businessId,
      {
        type: NotificationType.SALE_RECORDED,
        title,
        message,
        resourceType: 'SALE',
        resourceId,
      },
      manager,
    );
  }

  /**
   * Tells the manager who recorded a figure how the review ended, committed
   * with the decision itself (mirrors the daily-report review).
   */
  private async notifyRecorderOfDecision(
    sale: Sale,
    request: NotificationRequest,
    manager: EntityManager,
  ): Promise<void> {
    if (!sale.recordedBy) return;

    const recipients = await this.notifications.filterActiveUsers([sale.recordedBy]);
    await this.notifications.notifyUsers(recipients, request, {
      businessId: sale.businessId,
      manager,
    });
  }

  /**
   * A MANAGER's recording awaits confirmation; an admin's is confirmed by
   * definition — recording and approving are the same gesture when the actor
   * is head office (product decision, 2026-10).
   */
  private approvalStamp(actor: AuthenticatedUser): {
    approvalStatus: SaleApprovalStatus;
    approvedBy: string | null;
    approvedAt: Date | null;
  } {
    if (actor.role === UserRole.MANAGER) {
      return { approvalStatus: SaleApprovalStatus.PENDING, approvedBy: null, approvedAt: null };
    }
    return {
      approvalStatus: SaleApprovalStatus.APPROVED,
      approvedBy: actor.id,
      approvedAt: new Date(),
    };
  }

  /** Returns the negative of a litre quantity in NUMERIC(18,3) string form. */
  private negateQuantity(litres: string): string {
    return this.inventory.normaliseQuantity(DecimalMath.negate(DecimalMath.parse(litres)));
  }

  /** SALE-2026-000001, unique per business (docs/03 §53). */
  private async nextSaleNumber(businessId: string, manager: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear();
    const like = `SALE-${year}-%`;

    // getRawMany, not getMany: the partial select has no primary key, so
    // TypeORM's entity transformation returns no rows and the generator would
    // reissue the first number of the year, colliding on the second sale.
    const existing = await manager
      .getRepository(Sale)
      .createQueryBuilder('sale')
      .select('sale.sale_number', 'saleNumber')
      .where('sale.business_id = :businessId', { businessId })
      .andWhere('sale.sale_number LIKE :like', { like })
      .orderBy('sale.sale_number', 'DESC')
      .getRawMany<{ saleNumber: string | null }>();

    const highest = existing.reduce((max, row) => {
      const sequence = Number.parseInt(row.saleNumber?.split('-').pop() ?? '0', 10);
      return Number.isFinite(sequence) && sequence > max ? sequence : max;
    }, 0);

    return `SALE-${year}-${String(highest + 1).padStart(6, '0')}`;
  }
}
