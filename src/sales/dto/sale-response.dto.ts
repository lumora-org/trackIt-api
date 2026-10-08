import { ApiProperty } from '@nestjs/swagger';
import { SaleApprovalStatus, SaleRecordMode } from '../../common/enums/fuel.enum';

export class SaleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SALE-2026-000001' })
  saleNumber!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS', required: false })
  fuelTypeName?: string;

  @ApiProperty({ example: '8500.000' })
  litresSold!: string;

  @ApiProperty({ example: '1500.00', description: 'Price snapshot resolved by the backend' })
  unitPrice!: string;

  @ApiProperty({ example: '12750000.00', description: 'litresSold x unitPrice' })
  totalAmount!: string;

  @ApiProperty({
    enum: SaleRecordMode,
    description: 'SINGLE = one transaction; DAY_TOTAL = the day running total',
  })
  recordMode!: SaleRecordMode;

  @ApiProperty({
    enum: SaleApprovalStatus,
    description:
      'Admin confirmation: PENDING awaits review, APPROVED is confirmed, REJECTED must be revised',
  })
  approvalStatus!: SaleApprovalStatus;

  @ApiProperty({ nullable: true, description: 'Set when the figure was confirmed' })
  approvedAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'Why a figure was refused' })
  rejectionReason!: string | null;

  @ApiProperty()
  soldAt!: Date;

  @ApiProperty({ nullable: true, description: 'null while the sale is active' })
  voidedAt!: Date | null;

  @ApiProperty({ nullable: true })
  voidReason!: string | null;
}
