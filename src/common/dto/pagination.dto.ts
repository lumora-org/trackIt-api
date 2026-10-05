import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  get pageNumber(): number {
    return this.page ?? DEFAULT_PAGE;
  }

  get take(): number {
    return Math.min(this.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  }

  get skip(): number {
    return (this.pageNumber - 1) * this.take;
  }
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  to?: string;
}
