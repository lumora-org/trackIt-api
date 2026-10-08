import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Delivery } from '../entities/delivery.entity';

/**
 * Generates human-readable, business-scoped reference numbers of the form
 * `DEL-2026-000001`.
 *
 * The frontend never supplies an order, sale or delivery number
 * (docs/09 §8); the database's UNIQUE (business_id, ...) constraints remain the
 * real guarantee, and a collision surfaces as a 409 rather than silently
 * reusing a number.
 */
@Injectable()
export class DeliveryGeneratorService {
  private static readonly PREFIX = 'DEL';

  async nextDeliveryNumber(businessId: string, manager: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear();
    const like = `${DeliveryGeneratorService.PREFIX}-${year}-%`;

    // getRawMany, not getMany: the partial select has no primary key, so
    // TypeORM's entity transformation returns no rows and the generator would
    // reissue the first number of the year, colliding on every create.
    const existing = await manager
      .getRepository(Delivery)
      .createQueryBuilder('delivery')
      .select('delivery.delivery_number', 'deliveryNumber')
      .where('delivery.business_id = :businessId', { businessId })
      .andWhere('delivery.delivery_number LIKE :like', { like })
      .orderBy('delivery.delivery_number', 'DESC')
      .getRawMany<{ deliveryNumber: string | null }>();

    const highest = existing.reduce((max, row) => {
      const sequence = Number.parseInt(row.deliveryNumber?.split('-').pop() ?? '0', 10);
      return Number.isFinite(sequence) && sequence > max ? sequence : max;
    }, 0);

    return `${DeliveryGeneratorService.PREFIX}-${year}-${String(highest + 1).padStart(6, '0')}`;
  }
}
