import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { IncidentStatus } from '../../common/enums/report.enum';
import { BaseEntity } from '../../common/entities/base.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A branch incident report — the manager's free-text exception log (product
 * decision, 2026-10). This replaced the manager's financial daily report:
 * head office gets its money figures from the day-total sales, and a report
 * is only raised when something out of the ordinary needs explaining, e.g.
 * government vehicles collecting fuel without paying.
 *
 * There is deliberately no approve/reject workflow: an incident is a record
 * of something that happened, opened by the branch and acknowledged
 * (REVIEWED) by an admin once seen.
 */
@Index('incident_reports_business_id_branch_id', ['businessId', 'branchId'])
@Index('incident_reports_branch_id_incident_date', ['branchId', 'incidentDate'])
@Index('incident_reports_status', ['status'])
@Entity({ name: 'incident_reports' })
export class IncidentReport extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  /** Bare DATE — the business day the incident happened on. */
  @ApiProperty({ example: '2026-10-06' })
  @Column({ name: 'incident_date', type: 'date' })
  incidentDate!: string;

  @ApiProperty({ example: 'Government vehicles collected fuel without paying' })
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @ApiProperty({ example: 'Two vehicles with registration numbers … collected 120 L of PMS.' })
  @Column({ type: 'text' })
  description!: string;

  @ApiProperty({ enum: IncidentStatus })
  @Column({ type: 'enum', enumName: 'incident_report_status', default: IncidentStatus.OPEN })
  status!: IncidentStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'reported_by', type: 'uuid', nullable: true })
  reportedBy!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reported_by' })
  reporter!: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer!: User | null;
}
