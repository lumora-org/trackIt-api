import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DeliveryStatus } from '../common/enums/fuel.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Delivery } from './entities/delivery.entity';
import { DeliveryItem } from './entities/delivery-item.entity';
import { DeliveryItemResponseDto, DeliveryResponseDto } from './dto/delivery-response.dto';
import { ListDeliveriesQueryDto } from './dto/delivery.dto';
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
    private readonly authorization: AuthorizationService,
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
      .orderBy('delivery.created_at', 'DESC')
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
        `This delivery is already ${delivery.status.toLowerCase().replace('_', ' ')}.`,
      );
    }
  }
}
