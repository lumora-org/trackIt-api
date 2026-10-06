import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { InventoryTransactionType } from '../../common/enums/fuel.enum';
import { QUANTITY_PRECISION, QUANTITY_TYPE, BaseEntity } from '../../common/entities/base.entity';

/**
 * The append-only inventory ledger — the authoritative record of stock
 * (docs/03 §44, §49, §74).
 *
 * Sign convention (docs/03 §45):
 *   OPENING_BALANCE, DELIVERY, TRANSFER_IN  → positive
 *   SALE, TRANSFER_OUT                      → negative
 *   ADJUSTMENT, CORRECTION                  → either
 *
 * `balance_after` is a derived display snapshot, NOT the source of truth;
 * current stock is always `SUM(quantity_litres)`. Rows are never updated or
 * deleted — an error is fixed by appending a CORRECTION.
 */
@Index('inventory_transactions_business_id_branch_id', ['businessId', 'branchId'])
@Index('inventory_transactions_branch_id_fuel_type_id', ['branchId', 'fuelTypeId'])
@Index('inventory_transactions_occurred_at', ['occurredAt'])
@Index('inventory_transactions_reference', ['referenceType', 'referenceId'])
@Entity({ name: 'inventory_transactions' })
export class InventoryTransaction extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_type_id', type: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ enum: InventoryTransactionType })
  @Column({
    name: 'transaction_type',
    type: 'enum',
    enumName: 'inventory_transaction_type',
  })
  transactionType!: InventoryTransactionType;

  @ApiProperty({ example: '-8500.000', description: 'Signed litres' })
  @Column({ name: 'quantity_litres', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  quantityLitres!: string;

  @ApiProperty({ example: '46350.000', description: 'Derived snapshot, not authoritative' })
  @Column({ name: 'balance_after', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  balanceAfter!: string;

  @ApiProperty({ example: 'DELIVERY' })
  @Column({ name: 'reference_type', type: 'varchar', length: 50 })
  referenceType!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId!: string | null;

  @ApiProperty()
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @ApiProperty({ nullable: true })
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Alias used by the API surface; the column is `notes` (docs/03 §44). */
  get reason(): string | null {
    return this.notes;
  }
}
