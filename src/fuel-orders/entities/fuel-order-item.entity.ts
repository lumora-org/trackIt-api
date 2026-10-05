import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import {
  MONEY_PRECISION,
  MONEY_TYPE,
  QUANTITY_PRECISION,
  QUANTITY_TYPE,
  BaseEntity,
} from '../../common/entities/base.entity';
import { FuelOrder } from './fuel-order.entity';
import { FuelType } from '../../fuel-types/entities/fuel-type.entity';

@Entity({ name: 'fuel_order_items' })
export class FuelOrderItem extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_order_id', type: 'uuid' })
  fuelOrderId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_type_id', type: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '45000.000', description: 'CHECK: expected_quantity_litres > 0' })
  @Column({
    name: 'expected_quantity_litres',
    type: QUANTITY_TYPE,
    ...QUANTITY_PRECISION,
  })
  expectedQuantityLitres!: string;

  /**
   * Procurement cost per litre. This is never the retail price — retail pricing
   * lives in `fuel_prices` (docs/09 §14).
   */
  @ApiProperty({ example: '1200.00', description: 'CHECK: unit_cost > 0' })
  @Column({ name: 'unit_cost', type: MONEY_TYPE, ...MONEY_PRECISION })
  unitCost!: string;

  @ManyToOne(() => FuelOrder, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fuel_order_id' })
  fuelOrder!: FuelOrder;

  @ManyToOne(() => FuelType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_type_id' })
  fuelType!: FuelType;
}
