import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { QUANTITY_PRECISION, QUANTITY_TYPE, BaseEntity } from '../../common/entities/base.entity';
import { Delivery } from './delivery.entity';
import { FuelOrderItem } from '../../fuel-orders/entities/fuel-order-item.entity';
import { FuelType } from '../../fuel-types/entities/fuel-type.entity';

/**
 * `fuel_order_item_id` and `fuel_type_id` are both stored on purpose:
 *
 * - docs/03 §41 specifies `fuel_type_id`;
 * - PROMPT-B.E §5 specifies `fuel_order_item_id`;
 * - keeping the order-item FK lets us prove the item belongs to *this* order
 *   (which `fuel_type_id` alone cannot do), and keeps the ledger resolvable in
 *   a single join.
 */
@Index('delivery_items_delivery_id', ['deliveryId'])
@Index('delivery_items_fuel_order_item_id', ['fuelOrderItemId'])
@Entity({ name: 'delivery_items' })
export class DeliveryItem extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'delivery_id', type: 'uuid' })
  deliveryId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_order_item_id', type: 'uuid' })
  fuelOrderItemId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_type_id', type: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '45000.000' })
  @Column({
    name: 'expected_quantity_litres',
    type: QUANTITY_TYPE,
    ...QUANTITY_PRECISION,
  })
  expectedQuantityLitres!: string;

  /**
   * The authoritative quantity. Only this value moves inventory — the expected
   * quantity never does (docs/04 §49, PROMPT.md §25).
   */
  @ApiProperty({ nullable: true, example: '44850.000', description: 'CHECK: >= 0' })
  @Column({
    name: 'actual_quantity_litres',
    type: QUANTITY_TYPE,
    ...QUANTITY_PRECISION,
    nullable: true,
  })
  actualQuantityLitres!: string | null;

  /** Derived: actual - expected. Negative means a shortage (docs/03 §41). */
  @ApiProperty({ nullable: true, example: '-150.000' })
  @Column({
    name: 'difference_litres',
    type: QUANTITY_TYPE,
    ...QUANTITY_PRECISION,
    nullable: true,
  })
  differenceLitres!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'discrepancy_reason', type: 'text', nullable: true })
  discrepancyReason!: string | null;

  @ManyToOne(() => Delivery, (delivery) => delivery.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'delivery_id' })
  delivery!: Delivery;

  @ManyToOne(() => FuelOrderItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_order_item_id' })
  fuelOrderItem!: FuelOrderItem;

  @ManyToOne(() => FuelType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_type_id' })
  fuelType!: FuelType;
}
