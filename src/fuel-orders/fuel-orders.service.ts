import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { FuelOrderStatus } from '../common/enums/fuel.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { DecimalMath } from '../common/utils/money.util';
import { resolveDateRange } from '../common/utils/date.util';
import { ConfigService } from '@nestjs/config';
import {
  CANCELLABLE_FUEL_ORDER_STATUSES,
  canTransitionFuelOrder,
} from '../common/constants/state-transitions';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { BranchesService } from '../branches/branches.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { TankersService } from '../tankers/tankers.service';
import { FuelTypesService } from '../fuel-types/fuel-types.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { FuelOrder } from './entities/fuel-order.entity';
import { FuelOrderItem } from './entities/fuel-order-item.entity';
import {
  CancelFuelOrderDto,
  CreateFuelOrderDto,
  ListFuelOrdersQueryDto,
} from './dto/fuel-order.dto';
import { FuelOrderItemResponseDto, FuelOrderResponseDto } from './dto/fuel-order-response.dto';

@Injectable()
export class FuelOrdersService {
  private readonly logger = new Logger(FuelOrdersService.name);

  constructor(
    @InjectRepository(FuelOrder)
    private readonly repository: Repository<FuelOrder>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly branches: BranchesService,
    private readonly suppliers: SuppliersService,
    private readonly tankers: TankersService,
    private readonly fuelTypes: FuelTypesService,
    private readonly deliveries: DeliveriesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(order: FuelOrder): FuelOrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      supplier: { id: order.supplierId, name: order.supplier?.name ?? '' },
      destinationBranch: {
        id: order.destinationBranchId,
        name: order.destinationBranch?.name ?? '',
      },
      expectedDeliveryAt: order.expectedDeliveryAt,
      orderedAt: order.orderedAt,
      notes: order.notes,
      items: (order.items ?? []).map((item) => this.toItemResponse(item)),
    };
  }

  private toItemResponse(item: FuelOrderItem): FuelOrderItemResponseDto {
    return {
      fuelTypeId: item.fuelTypeId,
      fuelTypeName: item.fuelType?.name ?? '',
      expectedQuantityLitres: item.expectedQuantityLitres,
      unitCost: item.unitCost,
    };
  }

  async findAll(
    query: ListFuelOrdersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelOrderResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    const forcedBranchId = this.authorization.resolveBranchScope(actor);

    const builder = this.repository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .leftJoinAndSelect('item.fuelType', 'itemFuelType')
      .leftJoinAndSelect('order.supplier', 'supplier')
      .leftJoinAndSelect('order.destinationBranch', 'destinationBranch')
      .where('1 = 1')
      // Property path, not the DB column name: skip/take + joins makes TypeORM
      // resolve order criteria through entity metadata (see deliveries findAll).
      .orderBy('order.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('order.business_id = :businessId', { businessId });

    // A MANAGER sees orders destined for their own branch and nothing else.
    if (forcedBranchId) {
      builder.andWhere('order.destination_branch_id = :forcedBranchId', { forcedBranchId });
    }

    if (query.status) builder.andWhere('order.status = :status', { status: query.status });
    if (query.supplierId) {
      builder.andWhere('order.supplier_id = :supplierId', { supplierId: query.supplierId });
    }
    if (query.branchId) {
      builder.andWhere('order.destination_branch_id = :branchId', { branchId: query.branchId });
    }

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('order.created_at <= :rangeEnd', { rangeEnd: range.end })
        .andWhere('order.created_at >= :rangeStart', { rangeStart: range.start });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<FuelOrder> {
    const order = await this.repository.findOne({
      where: { id },
      relations: {
        items: { fuelType: true },
        supplier: true,
        destinationBranch: true,
      },
    });

    if (!order) throw notFound('The requested fuel order was not found.');

    if (!this.authorization.managesBusiness(actor, order.businessId)) {
      throw notFound('The requested fuel order was not found.');
    }

    // Managers are additionally confined to orders bound for their branch.
    if (actor.role === UserRole.MANAGER) {
      this.authorization.assertBranchAccess(actor, order.destinationBranchId);
    }

    return order;
  }

  /**
   * Creates a DRAFT order. Nothing here touches inventory: an order is a
   * procurement commitment, not stock (docs/09 §1, §2).
   */
  async create(
    dto: CreateFuelOrderDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<FuelOrder> {
    const businessId = this.requireBusinessId(actor);

    return this.dataSource.transaction(async (manager) => {
      const supplier = await this.suppliers.requireUsableSupplier(
        dto.supplierId,
        businessId,
        manager,
      );
      const branch = await this.branches.requireBranchInBusiness(
        dto.destinationBranchId,
        businessId,
      );

      const expectedDeliveryAt = new Date(dto.expectedDeliveryAt);
      if (Number.isNaN(expectedDeliveryAt.getTime())) {
        throw apiError(
          ErrorCode.VALIDATION_ERROR,
          'expectedDeliveryAt must be a valid ISO 8601 timestamp.',
        );
      }

      const repository = manager.getRepository(FuelOrder);

      const order = repository.create({
        businessId,
        orderNumber: await this.nextOrderNumber(businessId, manager),
        supplierId: supplier.id,
        destinationBranchId: branch.id,
        status: FuelOrderStatus.DRAFT,
        orderedAt: null,
        expectedDeliveryAt,
        notes: dto.notes?.trim() ?? null,
        createdBy: actor.id,
        cancelledAt: null,
        cancellationReason: null,
      });

      const saved = await repository.save(order);

      const itemRepository = manager.getRepository(FuelOrderItem);

      // A fuel type may not appear twice on one order: two rows for the same
      // grade would make the remaining-quantity arithmetic ambiguous.
      const seen = new Set<string>();
      const items: FuelOrderItem[] = [];

      for (const item of dto.items) {
        if (seen.has(item.fuelTypeId)) {
          throw apiError(
            ErrorCode.VALIDATION_ERROR,
            'Each fuel type may appear only once on an order.',
          );
        }
        seen.add(item.fuelTypeId);

        await this.fuelTypes.requireUsableFuelType(item.fuelTypeId, businessId, manager);

        items.push(
          itemRepository.create({
            fuelOrderId: saved.id,
            fuelTypeId: item.fuelTypeId,
            expectedQuantityLitres: this.quantitise(item.expectedQuantityLitres),
            unitCost: this.money(item.unitCost),
          }),
        );
      }

      await itemRepository.save(items);

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: branch.id },
        {
          action: AuditAction.FUEL_ORDER_CREATED,
          resourceType: AuditResourceType.FUEL_ORDER,
          resourceId: saved.id,
          newValues: { orderNumber: saved.orderNumber, itemCount: items.length },
        },
        manager,
      );

      this.logger.log(
        `Fuel order ${saved.orderNumber} created for branch ${branch.code} with ${items.length} item(s)`,
      );

      return this.findOneOrFail(saved.id, actor);
    });
  }

  /**
   * Moves an order along its lifecycle, rejecting anything not in the transition
   * table with 422 INVALID_ORDER_STATUS.
   *
   * `PATCH /fuel-orders/:id` deliberately does not exist, so a status can never
   * be set arbitrarily (PROMPT.md §22).
   */
  async transition(
    id: string,
    target: FuelOrderStatus,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
    options: { reason?: string; tankerId?: string } = {},
  ): Promise<FuelOrder> {
    const businessId = this.requireBusinessId(actor);

    const order = await this.findOneOrFail(id, actor);

    if (!canTransitionFuelOrder(order.status, target)) {
      throw apiError(
        ErrorCode.INVALID_ORDER_STATUS,
        `This order cannot move from ${order.status} to ${target}.`,
      );
    }

    if (target === FuelOrderStatus.CANCELLED) {
      const reason = options.reason?.trim();
      if (!reason) {
        throw apiError(ErrorCode.VALIDATION_ERROR, 'A cancellation reason is required.', [
          { field: 'reason', message: 'reason is required when cancelling an order' },
        ]);
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FuelOrder);

      // Re-read under a row lock so two concurrent transitions cannot both
      // succeed from the same starting status.
      const locked = await repository
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.id = :id', { id })
        .getOneOrFail();

      if (!canTransitionFuelOrder(locked.status, target)) {
        throw apiError(
          ErrorCode.INVALID_ORDER_STATUS,
          `This order cannot move from ${locked.status} to ${target}.`,
        );
      }

      locked.status = target;
      if (target === FuelOrderStatus.SUBMITTED) locked.orderedAt = new Date();
      if (target === FuelOrderStatus.CANCELLED) {
        locked.cancelledAt = new Date();
        locked.cancellationReason = options.reason?.trim() ?? null;
      }

      await repository.save(locked);

      // Going in transit is what makes the fuel physically receivable: the
      // PENDING delivery is created here so the branch manager can receive it.
      if (target === FuelOrderStatus.IN_TRANSIT) {
        const tanker = options.tankerId
          ? await this.tankers.requireUsableTanker(options.tankerId, businessId, manager)
          : null;

        const items = await manager
          .getRepository(FuelOrderItem)
          .createQueryBuilder('item')
          .leftJoinAndSelect('item.fuelType', 'fuelType')
          .where('item.fuel_order_id = :id', { id })
          .getMany();

        await this.deliveries.createPendingForOrder(
          {
            id: locked.id,
            businessId: locked.businessId,
            destinationBranchId: locked.destinationBranchId,
            orderNumber: locked.orderNumber,
            items: items.map((item) => ({
              id: item.id,
              fuelTypeId: item.fuelTypeId,
              expectedQuantityLitres: item.expectedQuantityLitres,
              expectedDeliveredLitres: '0',
            })),
          },
          tanker?.id ?? null,
          manager,
        );
      }

      const action =
        target === FuelOrderStatus.SUBMITTED
          ? AuditAction.FUEL_ORDER_SUBMITTED
          : target === FuelOrderStatus.CONFIRMED
            ? AuditAction.FUEL_ORDER_CONFIRMED
            : AuditAction.FUEL_ORDER_CANCELLED;

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: locked.destinationBranchId },
        {
          action,
          resourceType: AuditResourceType.FUEL_ORDER,
          resourceId: locked.id,
          metadata: {
            to: target,
            reason: options.reason ?? null,
            tankerId: options.tankerId ?? null,
          },
        },
        manager,
      );

      return this.findOneOrFail(locked.id, actor);
    });
  }

  async cancel(
    id: string,
    dto: CancelFuelOrderDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<FuelOrder> {
    const order = await this.findOneOrFail(id, actor);

    if (!CANCELLABLE_FUEL_ORDER_STATUSES.includes(order.status)) {
      throw apiError(
        ErrorCode.INVALID_ORDER_STATUS,
        `This order cannot be cancelled from ${order.status}.`,
      );
    }

    return this.transition(id, FuelOrderStatus.CANCELLED, actor, auditActor, {
      reason: dto.reason,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private money(value: number): string {
    return DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.MONEY_SCALE),
      DecimalMath.MONEY_SCALE,
    );
  }

  private quantitise(value: number): string {
    return DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.QUANTITY_SCALE),
      DecimalMath.QUANTITY_SCALE,
    );
  }

  private requireBusinessId(actor: AuthenticatedUser): string {
    if (!actor.businessId) {
      throw apiError(
        ErrorCode.BUSINESS_ACCESS_DENIED,
        'A business context is required to manage fuel orders.',
      );
    }
    return actor.businessId;
  }

  /** ORD-2026-000001, unique per business (docs/09 §8). */
  private async nextOrderNumber(businessId: string, manager: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear();
    const like = `ORD-${year}-%`;

    const existing = await manager
      .getRepository(FuelOrder)
      .createQueryBuilder('order')
      .select('order.order_number', 'order_number')
      .where('order.business_id = :businessId', { businessId })
      .andWhere('order.order_number LIKE :like', { like })
      .orderBy('order.order_number', 'DESC')
      .getMany();

    const highest = existing.reduce((max, row) => {
      const sequence = Number.parseInt(row.orderNumber.split('-').pop() ?? '0', 10);
      return Number.isFinite(sequence) && sequence > max ? sequence : max;
    }, 0);

    return `ORD-${year}-${String(highest + 1).padStart(6, '0')}`;
  }
}
