import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { BranchStatus } from '../../common/enums/business.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** Branch codes are identifiers, not free text (e.g. KBY-IKEJA). */
export const BRANCH_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class CreateBranchDto {
  @ApiProperty({ example: 'KBY Ikeja' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'KBY-IKEJA' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(BRANCH_CODE_PATTERN, { message: 'code may only contain letters, numbers, - and _' })
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Ikeja, Lagos' })
  @IsString()
  @MaxLength(2000)
  address!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  /**
   * Only meaningful for SUPER_ADMIN, who has no business of their own. An
   * ADMIN's business is always derived from the token, never from the body
   * (docs/06 §31).
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'SUPER_ADMIN only' })
  @IsOptional()
  @IsString()
  businessId?: string;
}

/**
 * There is no `PATCH /branches/:id/status` route — activation and deactivation
 * go through this same PATCH (PROMPT-B.E §4.3).
 */
export class UpdateBranchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(BRANCH_CODE_PATTERN, { message: 'code may only contain letters, numbers, - and _' })
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ enum: BranchStatus, description: 'ACTIVE or INACTIVE' })
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;
}

export class ListBranchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or code' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: BranchStatus })
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;
}
