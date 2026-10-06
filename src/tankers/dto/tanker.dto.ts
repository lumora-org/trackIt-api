import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AccountStatus } from '../../common/enums/user-role.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** Registration numbers compare case-insensitively in the unique index. */
export const TANKER_REGISTRATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

export class CreateTankerDto {
  @ApiProperty({ example: 'ABC-123-LA' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(TANKER_REGISTRATION_PATTERN, {
    message: 'registrationNumber may only contain letters, numbers, spaces, - and _',
  })
  @MaxLength(50)
  registrationNumber!: string;

  @ApiPropertyOptional({ nullable: true, example: 'TANK-001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tankerCode?: string | null;

  @ApiProperty({ example: 45000, description: 'Litres; the database CHECK enforces > 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'capacityLitres must be a number' })
  @IsPositive({ message: 'capacityLitres must be greater than 0' })
  capacityLitres!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  driverName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  driverPhone?: string | null;
}

export class UpdateTankerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(TANKER_REGISTRATION_PATTERN, {
    message: 'registrationNumber may only contain letters, numbers, spaces, - and _',
  })
  @MaxLength(50)
  registrationNumber?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tankerCode?: string | null;

  @ApiPropertyOptional({ description: 'Must remain greater than 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'capacityLitres must be a number' })
  @IsPositive({ message: 'capacityLitres must be greater than 0' })
  capacityLitres?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  driverName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  driverPhone?: string | null;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

export class ListTankersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on registration number or code' })
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
