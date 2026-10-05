import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InventoryReferenceType, InventoryTransactionType } from '../common/enums/fuel.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { DecimalMath } from '../common/utils/money.util';
import { resolveDateRange } from '../common/utils/date.util';
import { BranchesService } from '../branches/branches.service';
import { FuelTypesService } from '../fuel-types/fuel-types.service';
import { FuelPricesService } from '../fuel-prices/fuel-prices.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { Sale } from './entities/sale.entity';
import { CreateSaleDto, ListSalesQueryDto, VoidSaleDto } from './dto/sale.dto';
import { SaleResponseDto } from './dto/sale-response.dto';

/**
 * Sales is where pricing, revenue and inventory meet. Three rules hold
 * throughout:
 *
 * 1. The client never prices anything. unitPrice is resolved from the price
 *    interval applicable at soldAt and then snapshotted onto the row, so a later
 *    price change can never rewrite historical revenue (docs/08 §30).
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
      .orderBy('sale.sold_at', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('sale.business_id = :businessId', { businessId });
    if (forcedBranchId) builder.andWhere('sale.branch_id = :forcedBranchId', { forcedBranchId });
    if (query.fuelTypeId) {
      builder.andWhere('sale.fuel_type_id = :fuelTypeId', { fuelTypeId: query.fuelTypeId });
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
      await this.branches.requireBranchInBusiness(dto.branchId, businessId);
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
        .setLock('pessimistic_write')
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

  /** Returns the negative of a litre quantity in NUMERIC(18,3) string form. */
  private negateQuantity(litres: string): string {
    return this.inventory.normaliseQuantity(DecimalMath.negate(DecimalMath.parse(litres)));
  }

  /** SALE-2026-000001, unique per business (docs/03 §53). */
  private async nextSaleNumber(businessId: string, manager: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear();
    const like = `SALE-${year}-%`;

    const existing = await manager
      .getRepository(Sale)
      .createQueryBuilder('sale')
      .select('sale.sale_number', 'sale_number')
      .where('sale.business_id = :businessId', { businessId })
      .andWhere('sale.sale_number LIKE :like', { like })
      .orderBy('sale.sale_number', 'DESC')
      .getMany();

    const highest = existing.reduce((max, row) => {
      const sequence = Number.parseInt(row.saleNumber.split('-').pop() ?? '0', 10);
      return Number.isFinite(sequence) && sequence > max ? sequence : max;
    }, 0);

    return `SALE-${year}-${String(highest + 1).padStart(6, '0')}`;
  }
}
