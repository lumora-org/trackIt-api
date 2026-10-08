import { ApiProperty } from '@nestjs/swagger';

export class DailySalesFuelBreakdownDto {
  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS', required: false })
  fuelTypeName?: string;

  @ApiProperty({ example: '8500.000' })
  litresSold!: string;

  @ApiProperty({ example: '12750000.00' })
  revenue!: string;
}

/**
 * One (business day, branch) row of the admin roll-up: the day's aggregate of
 * every sale the branch manager recorded, with the per-fuel split and the
 * incidents raised for that day merged in.
 */
export class DailySalesSummaryRowDto {
  @ApiProperty({ example: '2026-10-06', description: 'Business-timezone calendar day' })
  date!: string;

  @ApiProperty({ format: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'K.B.Y GLOBAL INVESTMENT', required: false })
  businessName?: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'KBY Birnin-Gwari', required: false })
  branchName?: string;

  @ApiProperty({ example: 3, description: 'Non-voided sale records for the day' })
  saleCount!: number;

  @ApiProperty({ example: '8500.000' })
  totalLitres!: string;

  @ApiProperty({ example: '12750000.00' })
  totalRevenue!: string;

  @ApiProperty({ example: 1, description: 'Incidents raised for this branch on this day' })
  incidentCount!: number;

  @ApiProperty({ example: 1, description: 'Of those, still OPEN' })
  openIncidentCount!: number;

  @ApiProperty({ type: [DailySalesFuelBreakdownDto] })
  fuels!: DailySalesFuelBreakdownDto[];
}
