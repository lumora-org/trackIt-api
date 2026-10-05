import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateFuelPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({ example: 1500, description: 'Naira per litre, must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'pricePerLitre must be a number' })
  @IsPositive({ message: 'pricePerLitre must be greater than 0' })
  pricePerLitre!: number;

  @ApiProperty({ example: '2026-10-05T00:00:00.000Z' })
  @IsDateString({}, { message: 'effectiveFrom must be an ISO 8601 timestamp' })
  effectiveFrom!: string;
}

export class ListFuelPricesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

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
