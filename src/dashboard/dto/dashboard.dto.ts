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

export class ManagerReportStubDto {
  @ApiProperty({ example: 'DRAFT' })
  status!: string;
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
    type: ManagerReportStubDto,
    nullable: true,
    description: "Today's report status, or null when none exists",
  })
  dailyReport!: ManagerReportStubDto | null;
}
