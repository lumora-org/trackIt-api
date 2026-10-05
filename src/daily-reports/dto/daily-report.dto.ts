import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DailyReportStatus } from '../../common/enums/report.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** A reportDate is a bare DATE with no time and no timezone. */
export const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Only three fields, and none of them is a total. Every figure is derived from
 * the ledger and the sales table, so a manager cannot submit arbitrary numbers
 * (docs/03 §57, docs/04 §66).
 */
export class CreateDailyReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: '2026-10-05', description: 'Bare date, YYYY-MM-DD' })
  @IsDateString({ strict: false }, { message: 'reportDate must be a YYYY-MM-DD date' })
  @Matches(REPORT_DATE_PATTERN, { message: 'reportDate must be a bare YYYY-MM-DD date' })
  reportDate!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Normal business operations.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  managerNotes?: string | null;
}

export class RejectDailyReportDto {
  @ApiProperty({ example: 'Closing stock does not match the physical stock count.' })
  @IsString()
  @MinLength(3, { message: 'a rejection reason is required and must be meaningful' })
  @MaxLength(2000)
  reason!: string;
}

export class ListDailyReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: DailyReportStatus })
  @IsOptional()
  status?: DailyReportStatus;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
