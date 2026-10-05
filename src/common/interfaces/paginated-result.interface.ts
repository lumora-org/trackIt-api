import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 57 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class PaginatedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    return new PaginatedResult(items, {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    });
  }
}
