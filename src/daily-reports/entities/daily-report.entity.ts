import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { DailyReportStatus } from '../../common/enums/report.enum';
import {
  MONEY_PRECISION,
  MONEY_TYPE,
  QUANTITY_PRECISION,
  QUANTITY_TYPE,
  BaseEntity,
  pgEnum,
} from '../../common/entities/base.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A daily report is a *derived summary*, never an input: every figure is
 * computed from the ledger and sales tables when the report is created, so a
 * manager cannot submit arbitrary totals (docs/03 §57, docs/04 §66).
 *
 * Creating a report produces NO inventory transactions.
 *
 * `UNDER_REVIEW` exists in the enum for rendering parity but has no endpoint
 * that sets or clears it (PROMPT-B.E §3).
 */
@Index('daily_reports_business_id_branch_id', ['businessId', 'branchId'])
@Index('daily_reports_status', ['status'])
@Index('daily_reports_branch_id_report_date', ['branchId', 'reportDate'], { unique: true })
@Entity({ name: 'daily_reports' })
export class DailyReport extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  /** Bare DATE — no time, no timezone (PROMPT-B.E §2.7). */
  @ApiProperty({ example: '2026-10-05' })
  @Column({ name: 'report_date', type: 'date' })
  reportDate!: string;

  @ApiProperty({ enum: DailyReportStatus })
  @Column({ type: pgEnum('daily_report_status'), default: DailyReportStatus.DRAFT })
  status!: DailyReportStatus;

  @ApiProperty({ example: '10000.000', description: 'Ledger balance before the report date' })
  @Column({
    name: 'opening_stock_litres',
    type: QUANTITY_TYPE,
    ...QUANTITY_PRECISION,
  })
  openingStockLitres!: string;

  @ApiProperty({ example: '44850.000', description: 'DELIVERY rows on the report date' })
  @Column({ name: 'total_received_litres', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  totalReceivedLitres!: string;

  @ApiProperty({ example: '8500.000', description: 'Non-voided SALE rows on the report date' })
  @Column({ name: 'total_sold_litres', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  totalSoldLitres!: string;

  @ApiProperty({ example: '46350.000', description: 'opening + received - sold' })
  @Column({ name: 'closing_stock_litres', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  closingStockLitres!: string;

  @ApiProperty({ example: '12750000.00', description: 'Sum of non-voided sale amounts' })
  @Column({ name: 'total_revenue', type: MONEY_TYPE, ...MONEY_PRECISION })
  totalRevenue!: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'manager_notes', type: 'text', nullable: true })
  managerNotes!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submitted_by' })
  submitter!: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer!: User | null;
}
