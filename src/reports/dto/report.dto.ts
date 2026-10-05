import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum ReportKind {
  SALES = 'sales',
  INVENTORY = 'inventory',
  DELIVERIES = 'deliveries',
  DAILY_REPORTS = 'daily-reports',
}

export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;
}

export class ExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx'], default: 'xlsx' })
  @IsOptional()
  @IsEnum({ xlsx: 'xlsx' })
  format?: 'xlsx';
}
