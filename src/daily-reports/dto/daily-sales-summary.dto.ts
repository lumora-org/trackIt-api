import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Filters for the admin sales roll-up. Dates are bare calendar dates in the
 * business timezone; without them the window defaults to the last 30 days.
 */
export class DailySalesSummaryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Branch filter' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'SUPER_ADMIN only: scope the roll-up to one business.',
  })
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ example: '2026-09-07', description: 'Defaults to 29 days before `to`.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a calendar date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-06', description: 'Defaults to today.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a calendar date (YYYY-MM-DD)' })
  to?: string;
}
