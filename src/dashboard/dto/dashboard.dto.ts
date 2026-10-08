import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { InventoryStockDto } from '../../inventory/dto/inventory-response.dto';

export class AdminDashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Narrow to one branch' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'SUPER_ADMIN only: scope the overview to one business. ' +
      'Omitted, the overview aggregates every business on the platform. ' +
      'Other roles are always clamped to their own business.',
  })
  @IsOptional()
  @IsUUID()
  businessId?: string;
}

export class DashboardSummaryDto {
  @ApiProperty({ example: 3 })
  totalBranches!: number;

  @ApiProperty({ example: 135000 })
  totalFuelReceivedLitres!: string;

  @ApiProperty({ example: 42500 })
  totalFuelSoldLitres!: string;

  @ApiProperty({ example: '63750000.00' })
  totalRevenue!: string;

  @ApiProperty({ example: 1 })
  lowInventoryBranches!: number;
}

export class BranchPerformanceDto {
  @ApiProperty({ format: 'uuid', description: 'Business the branch belongs to' })
  businessId!: string;

  @ApiProperty({ example: 'K.B.Y GLOBAL INVESTMENT' })
  businessName!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'KBY Ikeja' })
  branchName!: string;

  @ApiProperty({ example: '15000.000' })
  fuelSoldLitres!: string;

  @ApiProperty({ example: '22500000.00' })
  revenue!: string;
}

export class AdminDashboardDto {
  @ApiProperty({ type: DashboardSummaryDto })
  summary!: DashboardSummaryDto;

  @ApiProperty({ type: [BranchPerformanceDto] })
  branches!: BranchPerformanceDto[];
}

export class ManagerTodayDto {
  @ApiProperty({ example: '8500.000' })
  litresSold!: string;

  @ApiProperty({ example: '12750000.00' })
  revenue!: string;
}

export class ManagerBranchDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'KBY Ikeja' })
  name!: string;
}

export class ManagerDashboardDto {
  @ApiProperty({ type: ManagerBranchDto })
  branch!: ManagerBranchDto;

  @ApiProperty({ type: [InventoryStockDto] })
  inventory!: InventoryStockDto[];

  @ApiProperty({ type: ManagerTodayDto })
  today!: ManagerTodayDto;

  @ApiProperty({
    example: true,
    description:
      "Whether any sale has been recorded for today's business day. Drives " +
      'the "record your sales" nudge on the manager dashboard (the day-total ' +
      'model replaced the daily-report status).',
  })
  salesRecordedToday!: boolean;
}
