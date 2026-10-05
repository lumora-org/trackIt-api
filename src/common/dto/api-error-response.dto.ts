import { ApiProperty } from '@nestjs/swagger';
import { ApiErrorDetail, ErrorCodeValue } from '../errors/error-codes';

export class FieldError implements ApiErrorDetail {
  @ApiProperty({ example: 'items.0.unitCost' })
  field!: string;

  @ApiProperty({ example: 'unitCost must be greater than 0' })
  message!: string;
}

/**
 * Swagger representation of the single error shape every non-2xx response uses
 * (docs/04 §7, PROMPT-B.E §2.6).
 */
export class ApiErrorResponse {
  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiProperty({ example: 'INSUFFICIENT_INVENTORY' })
  code!: ErrorCodeValue;

  @ApiProperty({ example: 'Insufficient PMS inventory.' })
  message!: string;

  @ApiProperty({
    required: false,
    type: [FieldError],
    description: 'Field-level detail, present on validation failures.',
  })
  errors?: FieldError[];

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/sales' })
  path!: string;
}
