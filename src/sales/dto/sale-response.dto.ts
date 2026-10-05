import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty()
  soldAt!: Date;

  @ApiProperty({ nullable: true, description: 'null while the sale is active' })
  voidedAt!: Date | null;

  @ApiProperty({ nullable: true })
  voidReason!: string | null;
}
