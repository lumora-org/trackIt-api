import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import {
  MONEY_PRECISION,
  MONEY_TYPE,
  QUANTITY_PRECISION,
  QUANTITY_TYPE,
  BaseEntity,
} from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { FuelType } from '../../fuel-types/entities/fuel-type.entity';
import { SaleApprovalStatus, SaleRecordMode } from '../../common/enums/fuel.enum';

/**
 * A sale is a historical financial fact: `unit_price` is a snapshot of the
 * price in force when the sale was recorded, never re-derived later
 * (docs/08 §30, §79). `total_amount` is computed by the backend — the client
 * cannot set it (PROMPT.md §35).
 *
 * CREATED vs VOIDED is decided by `voided_at` (docs/03 §50, PROMPT-B.E §3);
 * `approval_status` is the separate admin-confirmation workflow on top
 * (product decision, 2026-10) and never affects the figures.
 */
@Index('sales_business_id_branch_id', ['businessId', 'branchId'])
@Index('sales_branch_id_fuel_type_id', ['branchId', 'fuelTypeId'])
@Index('sales_sold_at', ['soldAt'])
@Index('sales_business_id_sale_number', ['businessId', 'saleNumber'], { unique: true })
@Entity({ name: 'sales' })
export class Sale extends BaseEntity {
  @ApiProperty({ example: 'SALE-2026-000001' })
  @Column({ name: 'sale_number', type: 'varchar', length: 50 })
  saleNumber!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_type_id', type: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '8500.000', description: 'CHECK: litres_sold > 0' })
  @Column({ name: 'litres_sold', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  litresSold!: string;

  /**
   * DAY_TOTAL marks the row as the branch's running total for one business
   * day rather than one counter transaction (product decision, 2026-10).
   * The partial unique index `sales_day_total_unique` keeps at most one such
   * row per branch, fuel and business day.
   */
  @ApiProperty({ enum: SaleRecordMode })
  @Column({
    name: 'record_mode',
    type: 'enum',
    enumName: 'sale_record_mode',
    default: SaleRecordMode.SINGLE,
  })
  recordMode!: SaleRecordMode;

  /** Admin confirmation of a manager-recorded figure (2026-10 product decision). */
  @ApiProperty({ enum: SaleApprovalStatus })
  @Column({
    name: 'approval_status',
    type: 'enum',
    enumName: 'sale_approval_status',
    default: SaleApprovalStatus.PENDING,
  })
  approvalStatus!: SaleApprovalStatus;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'Who confirmed the figure' })
  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'Set when a figure was refused' })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ example: '1500.00', description: 'Price snapshot resolved by the backend' })
  @Column({ name: 'unit_price', type: MONEY_TYPE, ...MONEY_PRECISION })
  unitPrice!: string;

  @ApiProperty({ example: '12750000.00', description: 'litres_sold × unit_price' })
  @Column({ name: 'total_amount', type: MONEY_TYPE, ...MONEY_PRECISION })
  totalAmount!: string;

  @ApiProperty()
  @Column({ name: 'sold_at', type: 'timestamptz' })
  soldAt!: Date;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy!: string | null;

  @ApiProperty({ nullable: true, description: 'null = active sale; non-null = voided' })
  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'voided_by', type: 'uuid', nullable: true })
  voidedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'recorded_by' })
  recorder!: User | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @ManyToOne(() => FuelType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_type_id' })
  fuelType!: FuelType;

  get isVoided(): boolean {
    return this.voidedAt !== null;
  }
}
