import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  DeliveryStatus,
  FuelOrderStatus,
  InventoryReferenceType,
  InventoryTransactionType,
} from '../common/enums/fuel.enum';
import { NotificationType } from '../common/enums/notification.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { DecimalMath } from '../common/utils/money.util';
import { canTransitionDelivery } from '../common/constants/state-transitions';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Delivery } from './entities/delivery.entity';
import { DeliveryItem } from './entities/delivery-item.entity';
import { DeliveryItemResponseDto, DeliveryResponseDto } from './dto/delivery-response.dto';
import { ListDeliveriesQueryDto } from './dto/delivery.dto';
import { ReceiveDeliveryDto } from './dto/receive-delivery.dto';
import { DeliveryGeneratorService } from './services/delivery-number.service';

/**
 * Deliveries are created by the backend when a fuel order goes in transit, not
 * by the client: the Deliveries screen only ever lists backend-created rows
 * (PROMPT-B.E §4.10).
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    @InjectRepository(Delivery)
    private readonly repository: Repository<Delivery>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly numbers: DeliveryGeneratorService,
  ) {}

  toResponse(delivery: Delivery): DeliveryResponseDto {
    return {
      id: delivery.id,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      fuelOrderId: delivery.fuelOrderId,
      tankerId: delivery.tankerId,
      destinationBranchId: delivery.destinationBranchId,
      deliveredAt: delivery.deliveredAt,
      notes: delivery.notes,
      items: (delivery.items ?? []).map((item) => this.toItemResponse(item)),
      ...(delivery.tanker
        ? {
            tanker: {
              id: delivery.tanker.id,
              registrationNumber: delivery.tanker.registrationNumber,
              driverName: delivery.tanker.driverName,
            },
          }
        : {}),
      ...(delivery.fuelOrder
        ? {
            fuelOrder: {
              id: delivery.fuelOrder.id,
              orderNumber: delivery.fuelOrder.orderNumber,
            },
          }
        : {}),
    };
  }

  private toItemResponse(item: DeliveryItem): DeliveryItemResponseDto {
    return {
      id: item.id,
      fuelTypeId: item.fuelTypeId,
      fuelTypeName: item.fuelType?.name,
      expectedQuantityLitres: item.expectedQuantityLitres,
      actualQuantityLitres: item.actualQuantityLitres,
      differenceLitres: item.differenceLitres,
      discrepancyReason: item.discrepancyReason,
    };
  }

  /**
   * Creates the PENDING delivery that a manager will eventually receive.
   *
   * Called by the fuel-order flow when an order goes IN_TRANSIT. One delivery is
   * created per order in the MVP; the schema and the remaining-quantity
   * calculation both support several deliveries per order (docs/09 §11), which
   * is what a split tanker load will need.
   */
  async createPendingForOrder(
    order: {
      id: string;
      businessId: string;
      destinationBranchId: string;
      orderNumber: string;
      items: Array<{
        id: string;
        fuelTypeId: string;
        expectedQuantityLitres: string;
        expectedDeliveredLitres: string;
      }>;
    },
    tankerId: string | null,
    manager: EntityManager,
  ): Promise<Delivery> {
    const repository = manager.getRepository(Delivery);

    const delivery = repository.create({
      businessId: order.businessId,
      fuelOrderId: order.id,
      tankerId,
      destinationBranchId: order.destinationBranchId,
      deliveryNumber: await this.numbers.nextDeliveryNumber(order.businessId, manager),
      status: DeliveryStatus.PENDING,
      deliveredAt: null,
      receivedBy: null,
      notes: null,
    });

    const saved = await repository.save(delivery);

    // Each order item that still has outstanding quantity gets a delivery item.
    // The expected quantity is the *outstanding* balance, so a second tanker
    // for the same order is expected to carry only what is left.
    const outstanding = order.items.filter(
      (item) =>
        Number.parseFloat(item.expectedQuantityLitres) > 0 &&
        Number.parseFloat(item.expectedDeliveredLitres) === 0,
    );

    if (outstanding.length > 0) {
      const itemRepository = manager.getRepository(DeliveryItem);
      await itemRepository.save(
        outstanding.map((orderItem) =>
          itemRepository.create({
            deliveryId: saved.id,
            fuelOrderItemId: orderItem.id,
            fuelTypeId: orderItem.fuelTypeId,
            expectedQuantityLitres: orderItem.expectedQuantityLitres,
            actualQuantityLitres: null,
            differenceLitres: null,
            discrepancyReason: null,
          }),
        ),
      );
    }

    this.logger.log(`Created pending delivery ${saved.id} for order ${order.orderNumber}`);

    return saved;
  }

  /** Scoped listing: a MANAGER only ever sees their own branch's deliveries. */
  async findAll(
    query: ListDeliveriesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<{ items: DeliveryResponseDto[]; total: number; page: number; limit: number }> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    const forcedBranchId = this.authorization.resolveBranchScope(actor);

    const builder = this.repository
      .createQueryBuilder('delivery')
      .leftJoinAndSelect('delivery.items', 'item')
      .leftJoinAndSelect('item.fuelType', 'itemFuelType')
      .leftJoinAndSelect('delivery.tanker', 'tanker')
      .leftJoinAndSelect('delivery.fuelOrder', 'fuelOrder')
      .where('1 = 1')
      // The two-step skip/take query resolves order criteria through entity
      // property paths, so this must be `createdAt`, not the DB column name —
      // an unknown path crashes TypeORM's ORDER BY merge (see fuel-orders/
      // sales findAll for the same pattern).
      .orderBy('delivery.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('delivery.business_id = :businessId', { businessId });
    if (forcedBranchId) {
      builder.andWhere('delivery.destination_branch_id = :forcedBranchId', {
        forcedBranchId,
      });
    }

    if (query.status) {
      builder.andWhere('delivery.delivery_status = :status', { status: query.status });
    }

    if (query.branchId) {
      builder.andWhere('delivery.destination_branch_id = :branchId', { branchId: query.branchId });
    }

    if (query.fuelOrderId) {
      builder.andWhere('delivery.fuel_order_id = :fuelOrderId', { fuelOrderId: query.fuelOrderId });
    }

    if (query.from)
      builder.andWhere('delivery.created_at >= :from', { from: new Date(query.from) });
    if (query.to) builder.andWhere('delivery.created_at <= :to', { to: new Date(query.to) });

    const [items, total] = await builder.getManyAndCount();

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page: query.pageNumber,
      limit: query.take,
    };
  }

  /**
   * Loads a delivery with everything the receiving screen renders.
   * Foreign resources answer 404 rather than 403 so tenant membership cannot be
   * probed (docs/06 §41).
   */
  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Delivery> {
    const delivery = await this.repository.findOne({
      where: { id },
      relations: {
        items: { fuelType: true },
        tanker: true,
        fuelOrder: true,
        destinationBranch: true,
      },
    });

    if (!delivery) throw notFound('The requested delivery was not found.');

    if (!this.authorization.managesBusiness(actor, delivery.businessId)) {
      throw notFound('The requested delivery was not found.');
    }

    this.authorization.assertBranchAccess(actor, delivery.destinationBranchId);

    return delivery;
  }
  /** Guards that a delivery can still be received or disputed. */
  assertPending(delivery: Delivery): void {
    if (delivery.status !== DeliveryStatus.PENDING) {
      throw apiError(
        ErrorCode.INVALID_DELIVERY_STATUS,
        `This delivery is already ${this.describeStatus(delivery.status)}.`,
      );
    }
  }

  /**
   * Receives a delivery: the authoritative inventory movement.
   *
   * Everything below happens inside ONE transaction, so a failure at any step
   * leaves no partial receipt (docs/04 §49, PROMPT.md §26):
   *
   *   1. lock the delivery and re-check it is still PENDING
   *   2. resolve and validate each item
   *   3. write one DELIVERY ledger row per item using the ACTUAL quantity
   *   4. record actual, difference = actual - expected, and any reason
   *   5. mark the delivery RECEIVED and advance the parent order
   *   6. raise notifications and audit rows
   *
   * Two independent guards make a double receive impossible: the status check
   * below, and the partial unique index in the migration on
   * (reference_id, fuel_type_id) WHERE reference_type = 'DELIVERY'.
   */
  async receive(
    id: string,
    dto: ReceiveDeliveryDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.findOneOrFail(id, actor);
    this.assertPending(delivery);

    const receivedAt = new Date();

    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Delivery);

      // Re-read under a row lock: two managers tapping Receive at once must not
      // both get past the status check.
      const locked = await repository
        .createQueryBuilder('delivery')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('delivery.items', 'item')
        .where('delivery.id = :id', { id })
        .getOne();

      if (!locked) throw notFound('The requested delivery was not found.');

      if (!canTransitionDelivery(locked.status, DeliveryStatus.RECEIVED)) {
        throw apiError(
          ErrorCode.INVALID_DELIVERY_STATUS,
          `This delivery is already ${this.describeStatus(locked.status)}.`,
        );
      }

      const items = locked.items ?? [];
      if (items.length === 0) {
        throw apiError(ErrorCode.INVALID_DELIVERY_STATUS, 'This delivery has no items to receive.');
      }

      const byFuelType = new Map(items.map((item) => [item.fuelTypeId, item]));

      // Reject an item the delivery does not actually contain, rather than
      // silently creating a ledger row for fuel that was never shipped.
      for (const submitted of dto.items) {
        if (!byFuelType.has(submitted.fuelTypeId)) {
          throw apiError(
            ErrorCode.VALIDATION_ERROR,
            'One of the submitted items is not part of this delivery.',
          );
        }
      }

      let anyDiscrepancy = false;
      const discrepancyLines: string[] = [];

      for (const item of items) {
        const submitted = dto.items.find((entry) => entry.fuelTypeId === item.fuelTypeId);

        if (!submitted) {
          throw apiError(
            ErrorCode.VALIDATION_ERROR,
            'A quantity is required for every item on the delivery.',
          );
        }

        if (submitted.actualQuantityLitres < 0) {
          throw apiError(
            ErrorCode.INVALID_DELIVERY_QUANTITY,
            'A received quantity must not be negative.',
          );
        }

        const actual = this.inventory.normaliseQuantity(submitted.actualQuantityLitres);

        // difference = actual - expected. Negative means a shortage.
        const difference = DecimalMath.subtract(
          DecimalMath.parse(actual),
          DecimalMath.parse(item.expectedQuantityLitres),
        );
        const differenceText = this.inventory.normaliseQuantity(difference);

        const isShortfall = DecimalMath.compare(difference, DecimalMath.parse('0')) !== 0;
        if (isShortfall) {
          anyDiscrepancy = true;
          discrepancyLines.push(
            `expected ${item.expectedQuantityLitres} L, received ${actual} L (${differenceText} L)`,
          );
        }

        // ONLY the actual quantity moves inventory. The expected quantity never
        // does (docs/04 §49, PROMPT.md §25).
        await this.inventory.post(
          {
            businessId: locked.businessId,
            branchId: locked.destinationBranchId,
            fuelTypeId: item.fuelTypeId,
            transactionType: InventoryTransactionType.DELIVERY,
            quantityLitres: actual,
            referenceType: InventoryReferenceType.DELIVERY,
            referenceId: locked.id,
            occurredAt: receivedAt,
            createdBy: actor.id,
            notes: submitted.discrepancyReason?.trim() || null,
          },
          manager,
        );

        item.actualQuantityLitres = actual;
        item.differenceLitres = differenceText;
        item.discrepancyReason = submitted.discrepancyReason?.trim() || null;
      }

      await manager.getRepository(DeliveryItem).save(items);

      locked.status = DeliveryStatus.RECEIVED;
      locked.deliveredAt = receivedAt;
      locked.receivedBy = actor.id;
      locked.notes = locked.notes ?? null;
      await repository.save(locked);

      // Advance the parent order: fully fulfilled becomes DELIVERED, partially
      // fulfilled becomes PARTIALLY_DELIVERED.
      const orderStatus = await this.advanceOrder(locked, manager);

      await this.audit.record(
        {
          ...auditActor,
          userId: actor.id,
          businessId: locked.businessId,
          branchId: locked.destinationBranchId,
        },
        {
          action: AuditAction.DELIVERY_RECEIVED,
          resourceType: AuditResourceType.DELIVERY,
          resourceId: locked.id,
          metadata: {
            deliveryNumber: locked.deliveryNumber,
            receivedLitres: items
              .map((item) => `${item.fuelTypeId}:${item.actualQuantityLitres}`)
              .join(','),
            hasDiscrepancy: anyDiscrepancy,
            orderStatus,
          },
        },
        manager,
      );

      await this.notifications.notifyBusinessAdmins(
        locked.businessId,
        {
          type: NotificationType.DELIVERY_RECEIVED,
          title: `Delivery ${locked.deliveryNumber ?? locked.id.slice(0, 8)} received`,
          message: `Fuel received into branch inventory.`,
          resourceType: 'DELIVERY',
          resourceId: locked.id,
        },
        manager,
      );

      // The receiving branch's managers get the same alert in their own feed.
      await this.notifications.notifyBranchManagers(
        locked.businessId,
        locked.destinationBranchId,
        {
          type: NotificationType.DELIVERY_RECEIVED,
          title: `Delivery ${locked.deliveryNumber ?? locked.id.slice(0, 8)} received`,
          message: `Fuel received into branch inventory.`,
          resourceType: 'DELIVERY',
          resourceId: locked.id,
        },
        manager,
      );

      if (anyDiscrepancy) {
        await this.notifications.notifyBusinessAdmins(
          locked.businessId,
          {
            type: NotificationType.DELIVERY_DISCREPANCY,
            title: 'Delivery quantity discrepancy detected',
            message: discrepancyLines.join('; '),
            resourceType: 'DELIVERY',
            resourceId: locked.id,
          },
          manager,
        );
      }

      return locked;
    });

    this.logger.log(
      `Delivery ${result.deliveryNumber ?? result.id} received into branch ${result.destinationBranchId}`,
    );

    return this.toResponse(result);
  }

  /**
   * Recomputes fulfilment from every RECEIVED delivery of the order and moves
   * it to DELIVERED or PARTIALLY_DELIVERED.
   *
   * Remaining quantity is aggregated per fuel type rather than per order item
   * (docs/09 §12), and a negative remainder means over-delivery, which is
   * reported rather than clamped.
   */
  private async advanceOrder(delivery: Delivery, manager: EntityManager): Promise<FuelOrderStatus> {
    const orderRepository = manager.getRepository('fuel_orders');
    const orderItemRepository = manager.getRepository('fuel_order_items');
    const deliveryItemRepository = manager.getRepository(DeliveryItem);

    const order = await orderRepository
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :orderId', { orderId: delivery.fuelOrderId })
      .getOne();

    if (!order) return FuelOrderStatus.IN_TRANSIT;

    // Terminal orders are left alone: a later corrective delivery must not
    // resurrect a closed order.
    if (order.status === FuelOrderStatus.DELIVERED || order.status === FuelOrderStatus.CANCELLED) {
      return order.status;
    }

    const expectedRows = await orderItemRepository
      .createQueryBuilder('item')
      .select('item.fuel_type_id', 'fuelTypeId')
      .addSelect('item.expected_quantity_litres', 'expected')
      .where('item.fuel_order_id = :orderId', { orderId: delivery.fuelOrderId })
      .getRawMany<{ fuelTypeId: string; expected: string }>();

    const receivedRows = await deliveryItemRepository
      .createQueryBuilder('item')
      .select('item.fuel_type_id', 'fuelTypeId')
      .addSelect('COALESCE(SUM(item.actual_quantity_litres), 0)', 'received')
      .innerJoin('deliveries', 'delivery', 'delivery.id = item.delivery_id')
      .where('delivery.fuel_order_id = :orderId', { orderId: delivery.fuelOrderId })
      .andWhere('delivery.delivery_status = :received', { received: DeliveryStatus.RECEIVED })
      .groupBy('item.fuel_type_id')
      .getRawMany<{ fuelTypeId: string; received: string }>();

    const receivedByFuel = new Map(receivedRows.map((row) => [row.fuelTypeId, row.received]));

    let allFulfilled = expectedRows.length > 0;
    for (const row of expectedRows) {
      const received = DecimalMath.parse(receivedByFuel.get(row.fuelTypeId) ?? '0');
      if (DecimalMath.compare(received, DecimalMath.parse(row.expected)) < 0) {
        allFulfilled = false;
        break;
      }
    }

    const next = allFulfilled ? FuelOrderStatus.DELIVERED : FuelOrderStatus.PARTIALLY_DELIVERED;
    order.status = next;
    await orderRepository.save(order);

    return next;
  }

  private describeStatus(status: DeliveryStatus): string {
    switch (status) {
      case DeliveryStatus.PENDING:
        return 'pending';
      case DeliveryStatus.RECEIVED:
        return 'received';
      case DeliveryStatus.CANCELLED:
        return 'cancelled';
      default:
        return 'in an unknown state';
    }
  }
}
