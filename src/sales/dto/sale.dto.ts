import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
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

export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
