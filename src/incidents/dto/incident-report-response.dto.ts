import { ApiProperty } from '@nestjs/swagger';
import { IncidentStatus } from '../../common/enums/report.enum';

export class IncidentReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'KBY Birnin-Gwari', required: false })
  branchName?: string;

  @ApiProperty({ example: '2026-10-06' })
  incidentDate!: string;

  @ApiProperty({ example: 'Government vehicles collected fuel without paying' })
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: IncidentStatus })
  status!: IncidentStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  reportedBy!: string | null;

  @ApiProperty({ example: 'Musa Doka', required: false, nullable: true })
  reportedByName?: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ApiProperty({ example: 'Admin User', required: false, nullable: true })
  reviewedByName?: string | null;

  @ApiProperty({ nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
