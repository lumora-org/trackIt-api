import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto, DEFAULT_LIMIT } from '../../common/dto/pagination.dto';

/** Audit listings default to a larger page than other collections (docs/04 §55). */
export const AUDIT_LOG_DEFAULT_LIMIT = 50;

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 'SALE_CREATED' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'SALE' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  businessId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ example: 'SALE_CREATED' })
  action!: string;

  @ApiProperty({ nullable: true, example: 'SALE' })
  resourceType!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  resourceId!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  oldValues!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  newValues!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export { DEFAULT_LIMIT };
