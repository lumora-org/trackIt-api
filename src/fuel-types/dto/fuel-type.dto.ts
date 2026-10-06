import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountStatus } from '../../common/enums/user-role.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** Codes are uppercase identifiers; PMS, AGO, DPK (docs/08 §70). */
export const FUEL_TYPE_CODE_PATTERN = /^[A-Z0-9_-]+$/;

export class CreateFuelTypeDto {
  @ApiProperty({ example: 'Premium Motor Spirit' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'PMS' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(FUEL_TYPE_CODE_PATTERN, {
    message: 'code may only contain uppercase letters, numbers, - and _',
  })
  @MaxLength(30)
  code!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Petrol' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

/** `code` is immutable after creation — historical references depend on it. */
export class UpdateFuelTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

export class ListFuelTypesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or code' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'SUPER_ADMIN only: scope the list to one business. ' +
      'Other roles are always clamped to their own business.',
  })
  @IsOptional()
  @IsUUID()
  businessId?: string;
}
