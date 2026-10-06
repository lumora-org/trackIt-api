import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { DecimalMath } from '../common/utils/money.util';
import {
  endOfDayInTimeZone,
  resolveDateRange,
  startOfDayInTimeZone,
  toDateOnlyInTimeZone,
} from '../common/utils/date.util';
import { InventoryService } from '../inventory/inventory.service';
import {
  AdminDashboardDto,
  AdminDashboardQueryDto,
  BranchPerformanceDto,
  ManagerDashboardDto,
} from './dto/dashboard.dto';

export interface MovementTotals {
  received: string;
  sold: string;
  revenue: string;
}

/**
 * Read-only aggregations for the dashboards.
 *
 * Every figure is derived from the ledger and the sales table rather than a
 * maintained counter, so a dashboard can never drift from the operational record
 * (docs/05 §117).
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly inventory: InventoryService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  private get lowStockThreshold(): string {
    return this.config.getOrThrow<string>('inventory.lowStockThresholdLitres');
  }

  /**
   * Business-wide overview: branches, volumes, revenue and per-branch
   * performance.
   *
   * from/to narrow the movement and revenue window only. Current-stock figures
   * are always "now", because stock is a point-in-time balance rather than a
   * period total.
   *
   * A SUPER_ADMIN may scope the overview to one business via `businessId`;
   * without it the figures aggregate every business on the platform. Other
   * roles are clamped to their own business by the authorization service.
   */
  async adminDashboard(
    query: AdminDashboardQueryDto,
    actor: AuthenticatedUser,
  ): Promise<AdminDashboardDto> {
    const businessId = this.authorization.resolveBusinessScope(actor, query.businessId ?? null);

    // A MANAGER is pinned to their own branch whatever they requested.
    const branchId = this.authorization.resolveBranchScope(actor, query.branchId);
    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    const start = range?.start ?? null;
    const end = range?.end ?? null;

    const totals = await this.movementTotals(branchId, start, end);
    const branches = await this.branchPerformance(businessId, branchId, start, end);

    return {
      summary: {
        totalBranches: await this.countBranches(businessId, branchId),
        totalFuelReceivedLitres: totals.received,
        totalFuelSoldLitres: totals.sold,
        totalRevenue: totals.revenue,
        lowInventoryBranches: await this.countLowInventoryBranches(businessId, branchId),
      },
      branches,
    };
  }

  /** A manager's own branch: stock, today's trading, and today's report. */
  async managerDashboard(actor: AuthenticatedUser): Promise<ManagerDashboardDto> {
    const branchId = actor.branchId;

    if (!branchId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'This account is not assigned to a branch.');
    }

    const branchRows = await this.dataSource.query(
      `SELECT id, name FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [branchId],
    );

    const branch = branchRows[0];
    if (!branch) {
      throw apiError(ErrorCode.RESOURCE_NOT_FOUND, 'The assigned branch was not found.');
    }

    const inventory = await this.inventory.currentStockMatrix({ branchId }, actor);

    // "Today" means the business day, so a manager sees their own trading day
    // rather than a UTC window that starts mid-afternoon.
    const today = toDateOnlyInTimeZone(new Date(), this.businessTimezone);
    const dayStart = startOfDayInTimeZone(today, this.businessTimezone);
    const dayEnd = endOfDayInTimeZone(today, this.businessTimezone);

    const todayTotals = await this.movementTotals(branchId, dayStart, dayEnd);

    const reportRows = await this.dataSource.query(
      `SELECT status FROM daily_reports WHERE branch_id = $1 AND report_date = $2`,
      [branchId, today],
    );

    return {
      branch: { id: branch.id, name: branch.name },
      inventory,
      today: { litresSold: todayTotals.sold, revenue: todayTotals.revenue },
      dailyReport: reportRows[0] ? { status: reportRows[0].status } : null,
    };
  }

  /**
   * Volumes received and sold plus revenue for an optional branch and window.
   *
   * SALE ledger rows are negative, so litres sold is negated back to a positive
   * quantity here — the same sign correction the daily report performs.
   */
  async movementTotals(
    branchId: string | null,
    start: Date | null,
    end: Date | null,
  ): Promise<MovementTotals> {
    const params: unknown[] = [];
    const clause = (column: string) => {
      const parts: string[] = [];
      if (branchId) {
        parts.push(`${column} = $${params.length + 1}`);
        params.push(branchId);
      }
      if (start) {
        parts.push(`${column} >= $${params.length + 1}`);
        params.push(start);
      }
      if (end) {
        parts.push(`${column} <= $${params.length + 1}`);
        params.push(end);
      }
      return parts.length ? ` AND ${parts.join(' AND ')}` : '';
    };

    const rows = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type = 'DELIVERY' THEN quantity_litres ELSE 0 END), 0) AS received,
         COALESCE(SUM(CASE WHEN transaction_type = 'SALE' THEN -quantity_litres ELSE 0 END), 0) AS sold
       FROM inventory_transactions
       WHERE TRUE${clause('branch_id')}`,
      params,
    );

    const revenueParams: unknown[] = [];
    const revenueClause: string[] = ['voided_at IS NULL'];
    if (branchId) {
      revenueClause.push(`branch_id = $${revenueParams.length + 1}`);
      revenueParams.push(branchId);
    }
    if (start) {
      revenueClause.push(`sold_at >= $${revenueParams.length + 1}`);
      revenueParams.push(start);
    }
    if (end) {
      revenueClause.push(`sold_at <= $${revenueParams.length + 1}`);
      revenueParams.push(end);
    }

    const revenueRows = await this.dataSource.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue
         FROM sales
        WHERE ${revenueClause.join(' AND ')}`,
      revenueParams,
    );

    return {
      received: this.quantity(rows[0]?.received ?? '0'),
      sold: this.quantity(rows[0]?.sold ?? '0'),
      revenue: this.money(revenueRows[0]?.revenue ?? '0'),
    };
  }

  /**
   * Per-branch sales performance for an optional business and window.
   *
   * A null `businessId` means the platform-wide view: branches of every
   * business appear, each tagged with its business name so the caller can tell
   * them apart.
   */
  private async branchPerformance(
    businessId: string | null,
    branchId: string | null,
    start: Date | null,
    end: Date | null,
  ): Promise<BranchPerformanceDto[]> {
    const params: unknown[] = [];
    const filters: string[] = [];

    if (businessId) {
      filters.push(`branch.business_id = $${params.length + 1}`);
      params.push(businessId);
    }
    if (branchId) {
      filters.push(`sale.branch_id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (start) {
      filters.push(`sale.sold_at >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      filters.push(`sale.sold_at <= $${params.length + 1}`);
      params.push(end);
    }

    // A LEFT JOIN keeps branches with no sales in the table, showing zeros,
    // rather than silently omitting them from the comparison.
    const rows = await this.dataSource.query(
      `SELECT branch.id                           AS branch_id,
              branch.business_id                  AS business_id,
              branch.name                         AS branch_name,
              business.name                       AS business_name,
              COALESCE(SUM(sale.litres_sold), 0)  AS litres_sold,
              COALESCE(SUM(sale.total_amount), 0) AS revenue
         FROM branches branch
         JOIN businesses business
           ON business.id = branch.business_id
         LEFT JOIN sales sale
           ON sale.branch_id = branch.id
          AND sale.voided_at IS NULL
          ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
        WHERE branch.deleted_at IS NULL
        GROUP BY branch.id, branch.name, branch.business_id, business.name
        ORDER BY business.name ASC, branch.name ASC`,
      params,
    );

    return rows.map(
      (row: {
        branch_id: string;
        business_id: string;
        business_name: string;
        branch_name: string;
        litres_sold: string;
        revenue: string;
      }) => ({
        businessId: row.business_id,
        businessName: row.business_name,
        branchId: row.branch_id,
        branchName: row.branch_name,
        fuelSoldLitres: this.quantity(row.litres_sold),
        revenue: this.money(row.revenue),
      }),
    );
  }

  private async countBranches(businessId: string | null, branchId: string | null): Promise<number> {
    const params: unknown[] = [];
    const parts: string[] = ['deleted_at IS NULL'];
    if (businessId) {
      params.push(businessId);
      parts.push(`business_id = $${params.length}`);
    }
    if (branchId) {
      params.push(branchId);
      parts.push(`id = $${params.length}`);
    }

    const rows = await this.dataSource.query(
      `SELECT COUNT(1) AS count FROM branches WHERE ${parts.join(' AND ')}`,
      params,
    );

    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Counts branches where at least one fuel type sits at or below the
   * configured threshold.
   *
   * docs/03 lists a LOW_INVENTORY notification type but never defines a
   * threshold or a reorder level, so the level is configuration
   * (LOW_INVENTORY_THRESHOLD_LITRES) rather than a hard-coded number.
   */
  private async countLowInventoryBranches(
    businessId: string | null,
    branchId: string | null,
  ): Promise<number> {
    const params: unknown[] = [];
    const parts: string[] = ['b.deleted_at IS NULL'];
    if (businessId) {
      params.push(businessId);
      parts.push(`b.business_id = $${params.length}`);
    }
    if (branchId) {
      params.push(branchId);
      parts.push(`b.id = $${params.length}`);
    }
    params.push(this.lowStockThreshold);
    const threshold = `$${params.length}`;

    const rows = await this.dataSource.query(
      `SELECT b.id
         FROM branches b
        WHERE ${parts.join(' AND ')}
          AND EXISTS (
            SELECT 1
              FROM fuel_types ft
             WHERE ft.business_id = b.business_id
               AND ft.deleted_at IS NULL
               AND COALESCE((
                     SELECT SUM(tx.quantity_litres)
                       FROM inventory_transactions tx
                      WHERE tx.branch_id = b.id
                        AND tx.fuel_type_id = ft.id
                   ), 0) <= ${threshold}::numeric
          )
        GROUP BY b.id`,
      params,
    );

    return rows.length;
  }

  private quantity(value: string): string {
    return DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.QUANTITY_SCALE),
      DecimalMath.QUANTITY_SCALE,
    );
  }

  private money(value: string): string {
    return DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.MONEY_SCALE),
      DecimalMath.MONEY_SCALE,
    );
  }
}
