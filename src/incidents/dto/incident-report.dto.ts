import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IncidentStatus } from '../../common/enums/report.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * An incident is free text by design: the manager describes what happened and
 * the date is defaults to today in the business timezone. There is no amount
 * and no litres field — financial figures belong to the day-total sale, the
 * incident only explains them.
 */
export class CreateIncidentReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({
    example: '2026-10-06',
    description: 'Business-timezone calendar day; defaults to today. Future dates are rejected.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'incidentDate must be a calendar date (YYYY-MM-DD)' })
  incidentDate?: string;

  @ApiProperty({ example: 'Government vehicles collected fuel without paying' })
  @IsString()
  @MinLength(3, { message: 'a title is required' })
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example:
      'Two vehicles collected 120 L of PMS at 14:05 without payment; details left with the supervisor.',
  })
  @IsString()
  @MinLength(3, { message: 'a description is required' })
  @MaxLength(5000)
  description!: string;
}

export class ListIncidentReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a calendar date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a calendar date (YYYY-MM-DD)' })
  to?: string;
}
