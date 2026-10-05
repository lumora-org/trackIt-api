import { ApiProperty } from '@nestjs/swagger';
import { InventoryTransactionType } from '../../common/enums/fuel.enum';

export class InventoryStockDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'KBY Ikeja' })
  branchName!: string;

  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS' })
  fuelTypeName!: string;

  @ApiProperty({ example: '12500.500', description: 'SUM(quantity_litres) over the ledger' })
  currentQuantityLitres!: string;
}

export class InventoryTransactionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ enum: InventoryTransactionType })
  transactionType!: InventoryTransactionType;

  @ApiProperty({ example: '-35.500', description: 'Signed litres' })
  quantityLitres!: string;

  @ApiProperty({ example: '12465.000', description: 'Derived snapshot, not authoritative' })
  balanceAfter!: string;

  @ApiProperty({ example: 'SALE' })
  referenceType!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  referenceId!: string | null;

  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty({ nullable: true })
  reason!: string | null;
}

/**
 * Note the key here is `fuelType`, not `fuelTypeName` — that asymmetry is
 * deliberate and matches what the frontend reads (PROMPT-B.E §4.11).
 */
export class InventorySummaryFuelDto {
  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS' })
  fuelType!: string;

  @ApiProperty({ example: '12500.500' })
  currentQuantityLitres!: string;
}

export class InventorySummaryDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty()
  asOf!: Date;

  @ApiProperty({ type: [InventorySummaryFuelDto] })
  fuel!: InventorySummaryFuelDto[];
}
