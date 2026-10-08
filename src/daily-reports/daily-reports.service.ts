import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { DailyReportStatus } from '../common/enums/report.enum';
import { InventoryTransactionType } from '../common/enums/fuel.enum';
import { NotificationType } from '../common/enums/notification.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { Decimal, DecimalMath } from '../common/utils/money.util';
import {
  endOfDayInTimeZone,
  resolveDateRange,
  startOfDayInTimeZone,
  toDateOnlyInTimeZone,
} from '../common/utils/date.util';
import { canTransitionDailyReport } from '../common/constants/state-transitions';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DailyReport } from './entities/daily-report.entity';
import {
  CreateDailyReportDto,
  ListDailyReportsQueryDto,
  RejectDailyReportDto,
} from './dto/daily-report.dto';
import { DailyReportResponseDto } from './dto/daily-report-response.dto';
import { DailySalesSummaryQueryDto } from './dto/daily-sales-summary.dto';
import {
  DailySalesFuelBreakdownDto,
  DailySalesSummaryRowDto,
} from './dto/daily-sales-summary-response.dto';

export interface ReportFigures {
  openingStockLitres: string;
  totalReceivedLitres: string;
  totalSoldLitres: string;
  closingStockLitres: string;
  totalRevenue: string;
}

/** Raw shapes of the roll-up queries (see `salesSummary`). */
interface SalesSummaryRawRow {
  summary_date: string;
  business_id: string;
  business_name: string;
  branch_id: string;
  branch_name: string;
  sale_count: string;
  litres_sold: string;
  revenue: string;
  total_count: string;
}

interface SalesSummaryFuelRawRow {
  summary_date: string;
  branch_id: string;
  fuel_type_id: string;
  fuel_type_name: string;
  litres_sold: string;
  revenue: string;
}

interface SalesSummaryIncidentRawRow {
  summary_date: string;
  branch_id: string;
  incident_count: string;
  open_incident_count: string;
}

/**
 * Daily reports are DERIVED SUMMARIES, never inputs.
 *
 * Every figure is computed from the inventory ledger and the sales table when
 * the report is created, so a manager cannot submit arbitrary totals
 * (docs/03 §57). Creating a report writes NO inventory transactions
 * (docs/03 §93) — a report observes stock, it never moves it.
 */
@Injectable()
export class DailyReportsService {
  private readonly logger = new Logger(DailyReportsService.name);

  constructor(
    @InjectRepository(DailyReport)
    private readonly repository: Repository<DailyReport>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly branches: BranchesService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(report: DailyReport): DailyReportResponseDto {
    return {
      id: report.id,
      branchId: report.branchId,
      reportDate: report.reportDate,
      status: report.status,
      openingStockLitres: report.openingStockLitres,
      totalReceivedLitres: report.totalReceivedLitres,
      totalSoldLitres: report.totalSoldLitres,
      closingStockLitres: report.closingStockLitres,
      totalRevenue: report.totalRevenue,
      managerNotes: report.managerNotes,
      reviewedBy: report.reviewedBy,
      reviewedAt: report.reviewedAt,
      rejectionReason: report.rejectionReason,
    };
  }

  /**
   * Computes every figure for a branch and day from the operational record.
   *
   *   opening  = ledger movement strictly before the business day
   *   received = DELIVERY rows during the day
   *   sold     = non-voided SALE rows during the day
   *   closing  = opening + received - sold
   *   revenue  = sum of non-voided sale amounts during the day
   *
   * Day boundaries are converted into UTC using the business timezone, so a
   * report always covers the same wall-clock day the manager meant regardless
   * of when the request is served.
   */
  async computeFigures(
    branchId: string,
    reportDate: string,
    manager?: EntityManager,
  ): Promise<ReportFigures> {
    const dayStart = startOfDayInTimeZone(reportDate, this.businessTimezone);
    const dayEnd = endOfDayInTimeZone(reportDate, this.businessTimezone);

    // Opening: everything that happened before the business day began.
    const opening = await this.inventory.sumBetween(branchId, new Date(0), dayStart, null, manager);

    // Received and sold are per fuel type, then totalled across grades: a
    // branch stocking PMS and AGO is one operational figure, not two.
    const receivedByFuel = await this.inventory.sumByTypeBetween(
      branchId,
      InventoryTransactionType.DELIVERY,
      dayStart,
      dayEnd,
      manager,
    );
    const soldByFuel = await this.inventory.sumByTypeBetween(
      branchId,
      InventoryTransactionType.SALE,
      dayStart,
      dayEnd,
      manager,
    );

    const totalReceived = this.sumAll(receivedByFuel);

    // SALE rows are stored NEGATIVE (docs/03 §45), so the ledger sum for the
    // day comes back as -8,500 for 8,500 litres sold. It must be negated before
    // being reported as a positive quantity and before being subtracted from
    // opening stock — otherwise closing stock would INCREASE by the amount
    // sold.
    const totalSold = this.sumAll(this.negateAll(soldByFuel));

    const closing = DecimalMath.subtract(
      DecimalMath.add(DecimalMath.parse(opening), DecimalMath.parse(totalReceived)),
      DecimalMath.parse(totalSold),
    );

    // Revenue from the sales table, not the ledger: only the sale row knows
    // what the litres were worth. Voided sales are excluded.
    const revenue = await this.sumNonVoidedRevenue(branchId, dayStart, dayEnd, manager);

    return {
      openingStockLitres: this.quantity(opening),
      totalReceivedLitres: this.quantity(totalReceived),
      totalSoldLitres: this.quantity(totalSold),
      closingStockLitres: this.quantity(closing),
      totalRevenue: this.money(revenue),
    };
  }

  async findAll(
    query: ListDailyReportsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<DailyReportResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    const forcedBranchId = this.authorization.resolveBranchScope(actor, query.branchId);

    const builder = this.repository
      .createQueryBuilder('report')
      .where('1 = 1')
      .orderBy('report.report_date', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('report.business_id = :businessId', { businessId });
    if (forcedBranchId) builder.andWhere('report.branch_id = :forcedBranchId', { forcedBranchId });
    if (query.status) builder.andWhere('report.status = :status', { status: query.status });

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('report.report_date >= :fromDate', { fromDate: this.toDateOnly(range.start) })
        .andWhere('report.report_date <= :toDate', { toDate: this.toDateOnly(range.end) });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  /**
   * Admin sales roll-up (product decision, 2026-10): the destination for
   * every sale a branch manager records.
   *
   * One row per (business day, branch) inside the window — no daily-report
   * submission is involved, the day the manager records a total it appears
   * here automatically. Each row carries the day's aggregate, the per-fuel
   * split, and the branch's incident counts for the same day.
   *
   * Days are grouped in the business timezone, which is also how the day-total
   * rows are pinned (sold_at = noon of the business day), so a window always
   * matches the day boundaries the managers saw.
   */
  async salesSummary(
    query: DailySalesSummaryQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<DailySalesSummaryRowDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor, query.businessId ?? null);

    const today = toDateOnlyInTimeZone(new Date(), this.businessTimezone);
    const to = query.to ?? today;
    const from =
      query.from ??
      toDateOnlyInTimeZone(
        new Date(startOfDayInTimeZone(today, this.businessTimezone).getTime() - 29 * 86_400_000),
        this.businessTimezone,
      );

    if (from > to) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'from must not be after to.');
    }

    const start = startOfDayInTimeZone(from, this.businessTimezone);
    // endOfDayInTimeZone is exclusive, so the `to` day is fully included.
    const end = endOfDayInTimeZone(to, this.businessTimezone);

    const params: unknown[] = [this.businessTimezone, start, end];
    const parts: string[] = ['s.voided_at IS NULL', 's.sold_at >= $2', 's.sold_at < $3'];
    if (businessId) {
      params.push(businessId);
      parts.push(`s.business_id = $${params.length}`);
    }
    if (query.branchId) {
      params.push(query.branchId);
      parts.push(`s.branch_id = $${params.length}`);
    }

    // The per-fuel split covers the whole window (not just the requested
    // page) and is merged per (day, branch) below — a window is at most a few
    // hundred groups, so this stays cheap and keeps the SQL trivial.
    const fuelRows: SalesSummaryFuelRawRow[] = await this.dataSource.query(
      `SELECT to_char((s.sold_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS summary_date,
              s.branch_id                                        AS branch_id,
              s.fuel_type_id                                     AS fuel_type_id,
              ft.name                                            AS fuel_type_name,
              COALESCE(SUM(s.litres_sold), 0)                    AS litres_sold,
              COALESCE(SUM(s.total_amount), 0)                   AS revenue
         FROM sales s
         JOIN fuel_types ft ON ft.id = s.fuel_type_id
        WHERE ${parts.join(' AND ')}
        GROUP BY 1, s.branch_id, s.fuel_type_id, ft.name
        ORDER BY ft.name ASC`,
      params,
    );

    params.push(query.take);
    const limitRef = `$${params.length}`;
    params.push(query.skip);
    const offsetRef = `$${params.length}`;

    const rows: SalesSummaryRawRow[] = await this.dataSource.query(
      `SELECT to_char((s.sold_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS summary_date,
              biz.id                                             AS business_id,
              biz.name                                           AS business_name,
              b.id                                               AS branch_id,
              b.name                                             AS branch_name,
              COUNT(*)                                           AS sale_count,
              COALESCE(SUM(s.litres_sold), 0)                    AS litres_sold,
              COALESCE(SUM(s.total_amount), 0)                   AS revenue,
              COUNT(*) OVER()                                    AS total_count
         FROM sales s
         JOIN branches b ON b.id = s.branch_id
         JOIN businesses biz ON biz.id = s.business_id
        WHERE ${parts.join(' AND ')}
        GROUP BY 1, biz.id, biz.name, b.id, b.name
        ORDER BY summary_date DESC, biz.name ASC, b.name ASC
        LIMIT ${limitRef} OFFSET ${offsetRef}`,
      params,
    );

    // Incidents are keyed by bare DATE, so they compare directly with the
    // business-tz dates above.
    const incidentParams: unknown[] = [from, to];
    const incidentParts: string[] = ['ir.incident_date >= $1', 'ir.incident_date <= $2'];
    if (businessId) {
      incidentParams.push(businessId);
      incidentParts.push(`ir.business_id = $${incidentParams.length}`);
    }
    if (query.branchId) {
      incidentParams.push(query.branchId);
      incidentParts.push(`ir.branch_id = $${incidentParams.length}`);
    }
    const incidentRows: SalesSummaryIncidentRawRow[] = await this.dataSource.query(
      `SELECT to_char(ir.incident_date, 'YYYY-MM-DD') AS summary_date,
              ir.branch_id                            AS branch_id,
              COUNT(*)                                AS incident_count,
              COUNT(*) FILTER (WHERE ir.status = 'OPEN') AS open_incident_count
         FROM incident_reports ir
        WHERE ${incidentParts.join(' AND ')}
        GROUP BY ir.incident_date, ir.branch_id`,
      incidentParams,
    );

    const fuelsByKey = new Map<string, DailySalesFuelBreakdownDto[]>();
    for (const row of fuelRows) {
      const key = `${row.summary_date}|${row.branch_id}`;
      const list = fuelsByKey.get(key) ?? [];
      list.push({
        fuelTypeId: row.fuel_type_id,
        fuelTypeName: row.fuel_type_name,
        litresSold: this.quantity(row.litres_sold),
        revenue: this.money(row.revenue),
      });
      fuelsByKey.set(key, list);
    }

    const incidentsByKey = new Map<string, { total: number; open: number }>();
    for (const row of incidentRows) {
      incidentsByKey.set(`${row.summary_date}|${row.branch_id}`, {
        total: Number(row.incident_count),
        open: Number(row.open_incident_count),
      });
    }

    const items = rows.map((row) => {
      const key = `${row.summary_date}|${row.branch_id}`;
      const incidents = incidentsByKey.get(key);
      return {
        date: row.summary_date,
        businessId: row.business_id,
        businessName: row.business_name,
        branchId: row.branch_id,
        branchName: row.branch_name,
        saleCount: Number(row.sale_count),
        totalLitres: this.quantity(row.litres_sold),
        totalRevenue: this.money(row.revenue),
        incidentCount: incidents?.total ?? 0,
        openIncidentCount: incidents?.open ?? 0,
        fuels: fuelsByKey.get(key) ?? [],
      };
    });

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

    return PaginatedResult.of(items, total, query.pageNumber, query.take);
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<DailyReport> {
    const report = await this.repository.findOne({ where: { id } });
    if (!report) throw notFound('The requested daily report was not found.');

    // A manager reaching for another branch's report is BRANCH_ACCESS_DENIED,
    // not a silent 404 (PROMPT-B.E §4.13).
    this.authorization.assertBusinessAccess(actor, report.businessId);
    this.authorization.assertBranchAccess(actor, report.branchId);

    return report;
  }

  /**
   * Generates a DRAFT report from the operational record.
   *
   * Rejects a future date, and rejects a second report for the same
   * (branch, date) — the database's UNIQUE (branch_id, report_date) is the real
   * guarantee, mapped to 409 REPORT_ALREADY_EXISTS by the error filter.
   */
  async create(
    dto: CreateDailyReportDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DailyReport> {
    const businessId = actor.businessId;
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    this.assertNotFuture(dto.reportDate);

    return this.dataSource.transaction(async (manager) => {
      await this.branches.requireBranchInBusiness(dto.branchId, businessId);

      const existing = await manager
        .getRepository(DailyReport)
        .findOne({ where: { branchId: dto.branchId, reportDate: dto.reportDate } });

      if (existing) {
        throw apiError(
          ErrorCode.REPORT_ALREADY_EXISTS,
          'A daily report already exists for this branch and date.',
        );
      }

      const figures = await this.computeFigures(dto.branchId, dto.reportDate, manager);

      const report = manager.getRepository(DailyReport).create({
        businessId,
        branchId: dto.branchId,
        reportDate: dto.reportDate,
        status: DailyReportStatus.DRAFT,
        ...figures,
        managerNotes: dto.managerNotes?.trim() ?? null,
        submittedBy: null,
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      });

      const saved = await manager.getRepository(DailyReport).save(report);

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: dto.branchId },
        {
          action: AuditAction.DAILY_REPORT_CREATED,
          resourceType: AuditResourceType.DAILY_REPORT,
          resourceId: saved.id,
          metadata: { reportDate: dto.reportDate, ...figures },
        },
        manager,
      );

      return saved;
    });
  }

  /** DRAFT → SUBMITTED, then notifies the business admins. */
  async submit(
    id: string,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DailyReport> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.status !== DailyReportStatus.DRAFT) {
      throw apiError(
        ErrorCode.REPORT_NOT_SUBMITTABLE,
        `Only a draft report can be submitted; this one is ${existing.status}.`,
      );
    }

    const saved = await this.applyTransition(existing, DailyReportStatus.SUBMITTED, actor);

    // Recompute before submitting so the approved figures are current.
    const figures = await this.computeFigures(existing.branchId, existing.reportDate);
    await this.repository.update(existing.id, { ...figures });

    await this.notifications.notifyBusinessAdmins(existing.businessId, {
      type: NotificationType.REPORT_SUBMITTED,
      title: 'Daily report submitted',
      message: `Report for ${existing.reportDate} is awaiting review.`,
      resourceType: 'DAILY_REPORT',
      resourceId: existing.id,
    });

    await this.audit.record(
      {
        ...auditActor,
        userId: actor.id,
        businessId: existing.businessId,
        branchId: existing.branchId,
      },
      {
        action: AuditAction.DAILY_REPORT_SUBMITTED,
        resourceType: AuditResourceType.DAILY_REPORT,
        resourceId: existing.id,
        metadata: { reportDate: existing.reportDate },
      },
    );

    return this.findOneOrFail(saved.id, actor);
  }

  /** SUBMITTED|UNDER_REVIEW → APPROVED, then notifies the author. */
  async approve(
    id: string,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DailyReport> {
    const existing = await this.findOneOrFail(id, actor);

    if (
      existing.status !== DailyReportStatus.SUBMITTED &&
      existing.status !== DailyReportStatus.UNDER_REVIEW
    ) {
      throw apiError(
        ErrorCode.REPORT_NOT_APPROVABLE,
        `This report cannot be approved while it is ${existing.status}.`,
      );
    }

    // Separation of duties: nobody may approve their own report (docs/06 §4).
    if (existing.submittedBy && existing.submittedBy === actor.id) {
      throw invalidOperation('You cannot approve a report you submitted yourself.');
    }

    const reviewedAt = new Date();

    const saved = await this.applyTransition(existing, DailyReportStatus.APPROVED, actor, {
      reviewedBy: actor.id,
      reviewedAt,
    });

    if (existing.submittedBy) {
      await this.notifications.notifyUsers(
        await this.notifications.filterActiveUsers([existing.submittedBy]),
        {
          type: NotificationType.REPORT_APPROVED,
          title: 'Daily report approved',
          message: `Your report for ${existing.reportDate} was approved.`,
          resourceType: 'DAILY_REPORT',
          resourceId: existing.id,
        },
        { businessId: existing.businessId },
      );
    }

    await this.audit.record(
      {
        ...auditActor,
        userId: actor.id,
        businessId: existing.businessId,
        branchId: existing.branchId,
      },
      {
        action: AuditAction.DAILY_REPORT_APPROVED,
        resourceType: AuditResourceType.DAILY_REPORT,
        resourceId: existing.id,
        metadata: {
          reportDate: existing.reportDate,
          openingStock: saved.openingStockLitres,
          closingStock: saved.closingStockLitres,
          totalRevenue: saved.totalRevenue,
        },
      },
    );

    this.logger.log(`Daily report ${saved.id} for ${saved.reportDate} approved by ${actor.id}`);

    return this.findOneOrFail(saved.id, actor);
  }

  /** SUBMITTED|UNDER_REVIEW → REJECTED with a mandatory reason. */
  async reject(
    id: string,
    dto: RejectDailyReportDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DailyReport> {
    const existing = await this.findOneOrFail(id, actor);

    if (
      existing.status !== DailyReportStatus.SUBMITTED &&
      existing.status !== DailyReportStatus.UNDER_REVIEW
    ) {
      throw apiError(
        ErrorCode.INVALID_REPORT_STATUS,
        `This report cannot be rejected while it is ${existing.status}.`,
      );
    }

    const reason = dto.reason.trim();
    if (!reason) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'A rejection reason is required.', [
        { field: 'reason', message: 'reason is required when rejecting a report' },
      ]);
    }

    await this.applyTransition(existing, DailyReportStatus.REJECTED, actor, {
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      rejectionReason: reason,
    });

    if (existing.submittedBy) {
      await this.notifications.notifyUsers(
        await this.notifications.filterActiveUsers([existing.submittedBy]),
        {
          type: NotificationType.REPORT_REJECTED,
          title: 'Daily report rejected',
          message: reason,
          resourceType: 'DAILY_REPORT',
          resourceId: existing.id,
        },
        { businessId: existing.businessId },
      );
    }

    await this.audit.record(
      {
        ...auditActor,
        userId: actor.id,
        businessId: existing.businessId,
        branchId: existing.branchId,
      },
      {
        action: AuditAction.DAILY_REPORT_REJECTED,
        resourceType: AuditResourceType.DAILY_REPORT,
        resourceId: existing.id,
        metadata: { reportDate: existing.reportDate, reason },
      },
    );

    return this.findOneOrFail(id, actor);
  }

  /**
   * REJECTED → DRAFT so the manager can correct the figures and submit again.
   * This returns to DRAFT, not straight to SUBMITTED, so the edit is possible.
   */
  async resubmit(
    id: string,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<DailyReport> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.status !== DailyReportStatus.REJECTED) {
      throw apiError(
        ErrorCode.INVALID_REPORT_STATUS,
        `Only a rejected report can be resubmitted; this one is ${existing.status}.`,
      );
    }

    await this.applyTransition(existing, DailyReportStatus.DRAFT, actor, {
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
    });

    // Refresh the derived figures so the manager edits current numbers.
    const figures = await this.computeFigures(existing.branchId, existing.reportDate);
    await this.repository.update(existing.id, { ...figures });

    await this.audit.record(
      {
        ...auditActor,
        userId: actor.id,
        businessId: existing.businessId,
        branchId: existing.branchId,
      },
      {
        action: AuditAction.DAILY_REPORT_CREATED,
        resourceType: AuditResourceType.DAILY_REPORT,
        resourceId: existing.id,
        metadata: { reportDate: existing.reportDate, transition: 'REJECTED->DRAFT', ...figures },
      },
    );

    return this.findOneOrFail(id, actor);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async applyTransition(
    report: DailyReport,
    target: DailyReportStatus,
    actor: AuthenticatedUser,
    extra: Partial<DailyReport> = {},
  ): Promise<DailyReport> {
    if (!canTransitionDailyReport(report.status, target)) {
      throw apiError(
        ErrorCode.INVALID_REPORT_STATUS,
        `This report cannot move from ${report.status} to ${target}.`,
      );
    }

    const patch: Partial<DailyReport> = { status: target, ...extra };

    if (target === DailyReportStatus.SUBMITTED) {
      patch.submittedBy = actor.id;
      patch.submittedAt = new Date();
    }

    const updated = await this.repository.save({ ...report, ...patch });
    return updated;
  }

  private assertNotFuture(reportDate: string): void {
    const dayStart = startOfDayInTimeZone(reportDate, this.businessTimezone);
    if (dayStart.getTime() > Date.now()) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'A report cannot be created for a future date.', [
        { field: 'reportDate', message: 'reportDate must not be in the future' },
      ]);
    }
  }

  private async sumNonVoidedRevenue(
    branchId: string,
    start: Date,
    end: Date,
    manager?: EntityManager,
  ): Promise<string> {
    const executor = manager ? { query: manager.query.bind(manager) } : this.dataSource;
    const raw = await executor.query(
      `SELECT COALESCE(SUM(s.total_amount), 0) AS revenue
         FROM sales s
        WHERE s.branch_id = $1
          AND s.voided_at IS NULL
          AND s.sold_at >= $2
          AND s.sold_at < $3`,
      [branchId, start, end],
    );

    return raw?.[0]?.revenue ?? '0';
  }

  /** Flips the sign of every value, turning stored SALE rows into litres sold. */
  private negateAll(values: Map<string, string>): Map<string, string> {
    return new Map(
      [...values.entries()].map(([fuelTypeId, value]) => [
        fuelTypeId,
        this.quantity(DecimalMath.negate(DecimalMath.parse(value))),
      ]),
    );
  }

  private sumAll(values: Map<string, string>): string {
    let total = DecimalMath.parse('0');
    for (const value of values.values()) {
      total = DecimalMath.add(total, DecimalMath.parse(value));
    }
    return this.quantity(total);
  }

  private quantity(value: string | Decimal): string {
    const decimal = typeof value === 'object' ? value : DecimalMath.parse(value);
    return DecimalMath.toFixedString(
      DecimalMath.rescale(decimal, DecimalMath.QUANTITY_SCALE),
      DecimalMath.QUANTITY_SCALE,
    );
  }

  private money(value: string): string {
    return DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.MONEY_SCALE),
      DecimalMath.MONEY_SCALE,
    );
  }

  /** A reportDate is a bare date, so timestamps are rendered in business time. */
  private toDateOnly(instant: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }
}
