import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SaleApprovalStatus, SaleRecordMode } from '../../common/enums/fuel.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Exactly four fields, by design.
 *
 * There is deliberately no unitPrice and no totalAmount: the backend resolves
 * the price applicable at soldAt and computes the amount itself. Anything the
 * client sent for either would be a privilege-escalation and fraud vector
 * (docs/08 §33, PROMPT.md §35).
 */
export class CreateSaleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({ example: 8500, description: 'Litres sold, must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'litresSold must be a number' })
  @Min(0.001, { message: 'litresSold must be greater than 0' })
  litresSold!: number;

  @ApiPropertyOptional({
    example: '2026-10-05T15:30:00.000Z',
    description: 'Defaults to now. Determines which price interval applies.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'soldAt must be an ISO 8601 timestamp' })
  soldAt?: string;
}

export class VoidSaleDto {
  @ApiProperty({ example: 'Duplicate sale entry' })
  @IsString()
  @MinLength(3, { message: 'a void reason is required and must be meaningful' })
  @MaxLength(2000)
  reason!: string;
}

/** A rejection is refused without a reason, mirroring the daily-report review. */
export class RejectSaleDto {
  @ApiProperty({ example: 'Figure does not match the pump reading' })
  @IsString()
  @MinLength(3, { message: 'a rejection reason is required and must be meaningful' })
  @MaxLength(2000)
  reason!: string;
}

/**
 * The manager's day-total figure for one fuel: the running total litres sold
 * on a business day, revised in place as the day goes on (product decision,
 * 2026-10).
 *
 * Again there is no unitPrice and no totalAmount — the backend prices the
 * added litres and computes the amount. `totalLitres: 0` clears the day's
 * record and restores the stock it had booked.
 */
export class RecordDayTotalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({
    example: 8500,
    description: 'Total litres sold on the day so far; 0 clears the day.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'totalLitres must be a number' })
  @Min(0, { message: 'totalLitres cannot be negative' })
  totalLitres!: number;

  @ApiPropertyOptional({
    example: '2026-10-06',
    description: 'Business-timezone calendar day; defaults to today. Future dates are rejected.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a calendar date (YYYY-MM-DD)' })
  date?: string;
}

export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

  @ApiPropertyOptional({ enum: SaleRecordMode, description: 'SINGLE or DAY_TOTAL' })
  @IsOptional()
  @IsEnum(SaleRecordMode)
  recordMode?: SaleRecordMode;

  @ApiPropertyOptional({
    enum: SaleApprovalStatus,
    description: 'PENDING, APPROVED or REJECTED — the admin confirmation gate',
  })
  @IsOptional()
  @IsEnum(SaleApprovalStatus)
  approvalStatus?: SaleApprovalStatus;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
