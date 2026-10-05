import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { DeliveryStatus } from '../../common/enums/fuel.enum';
import { BaseEntity, pgEnum } from '../../common/entities/base.entity';
import { FuelOrder } from '../../fuel-orders/entities/fuel-order.entity';
import { Tanker } from '../../tankers/entities/tanker.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';
import { DeliveryItem } from './delivery-item.entity';

@Index('deliveries_business_id', ['businessId'])
@Index('deliveries_destination_branch_id', ['destinationBranchId'])
@Index('deliveries_fuel_order_id', ['fuelOrderId'])
@Index('deliveries_delivered_at', ['deliveredAt'])
@Entity({ name: 'deliveries' })
export class Delivery extends BaseEntity {
  @ApiProperty({ nullable: true, example: 'DEL-2026-000001' })
  @Column({ name: 'delivery_number', type: 'varchar', length: 50, nullable: true })
  deliveryNumber!: string | null;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_order_id', type: 'uuid' })
  fuelOrderId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'tanker_id', type: 'uuid', nullable: true })
  tankerId!: string | null;

  /** Inventory is always posted here — the destination branch. */
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'destination_branch_id', type: 'uuid' })
  destinationBranchId!: string;

  @ApiProperty({ enum: DeliveryStatus })
  @Column({
    name: 'delivery_status',
    type: pgEnum('delivery_status'),
    default: DeliveryStatus.PENDING,
  })
  status!: DeliveryStatus;

  @ApiProperty({ nullable: true })
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'received_by', type: 'uuid', nullable: true })
  receivedBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'dispute_reason', type: 'text', nullable: true })
  disputeReason!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne(() => FuelOrder, (order) => order.deliveries, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_order_id' })
  fuelOrder!: FuelOrder;

  @ManyToOne(() => Tanker, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'tanker_id' })
  tanker!: Tanker | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'destination_branch_id' })
  destinationBranch!: Branch;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'received_by' })
  receiver!: User | null;

  @OneToMany(() => DeliveryItem, (item) => item.delivery, { cascade: true })
  items!: DeliveryItem[];
}
