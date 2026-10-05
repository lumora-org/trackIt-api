import { ApiProperty } from '@nestjs/swagger';
import { DailyReportStatus } from '../../common/enums/report.enum';

export class DailyReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: '2026-10-05', description: 'Bare date, no time or timezone' })
  reportDate!: string;

  @ApiProperty({ enum: DailyReportStatus })
  status!: DailyReportStatus;

  @ApiProperty({ example: '10000.000', description: 'Ledger balance before the report date' })
  openingStockLitres!: string;

  @ApiProperty({ example: '44850.000', description: 'DELIVERY rows on the report date' })
  totalReceivedLitres!: string;

  @ApiProperty({ example: '8500.000', description: 'Non-voided SALE rows on the report date' })
  totalSoldLitres!: string;

  @ApiProperty({
    example: '46350.000',
    description: 'opening + received - sold, so it always reconciles',
  })
  closingStockLitres!: string;

  @ApiProperty({ example: '12750000.00', description: 'Sum of non-voided sale amounts' })
  totalRevenue!: string;

  @ApiProperty({ nullable: true })
  managerNotes!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  reviewedBy?: string | null;

  @ApiProperty({ nullable: true })
  reviewedAt?: Date | null;

  @ApiProperty({ nullable: true })
  rejectionReason?: string | null;
}
