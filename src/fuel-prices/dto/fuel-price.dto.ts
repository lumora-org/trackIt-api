import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Price changes take effect immediately (product decision 2026-10): there is
 * deliberately no `effectiveFrom` — the server stamps the current instant.
 * With `forbidNonWhitelisted` enabled, a client still sending one is rejected
 * with a validation error rather than silently scheduling a change.
 */
export class CreateFuelPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({ example: 1600, description: 'Naira per litre, must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'pricePerLitre must be a number' })
  @IsPositive({ message: 'pricePerLitre must be greater than 0' })
  pricePerLitre!: number;
}

export class ListFuelPricesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'SUPER_ADMIN only: scope the list to one business. ' +
      'Other roles are always clamped to their own business.',
  })
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only intervals containing the current instant. Accepts ?active=true, ' +
      '?active=1 or a bare ?active.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}
