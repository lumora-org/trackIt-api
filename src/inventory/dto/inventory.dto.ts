import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { InventoryTransactionType } from '../../common/enums/fuel.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * An adjustment writes one new immutable ledger row. It never edits a
 * historical transaction (docs/03 §49, docs/04 §57).
 */
export class CreateAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({
    example: -100,
    description: 'Signed litres: negative removes stock, positive adds it',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantityLitres must be a number' })
  quantityLitres!: number;

  @ApiProperty({ example: 'Physical stock count discrepancy' })
  @IsString()
  @MinLength(3, { message: 'a reason is required and must be meaningful' })
  @MaxLength(2000)
  reason!: string;
}

export class ListInventoryQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;
}

export class InventorySummaryQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ListInventoryTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

  @ApiPropertyOptional({ enum: InventoryTransactionType })
  @IsOptional()
  @IsEnum(InventoryTransactionType)
  type?: InventoryTransactionType;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
