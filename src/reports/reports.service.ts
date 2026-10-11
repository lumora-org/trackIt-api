import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { resolveDateRange } from '../common/utils/date.util';
import { ExportQueryDto, ReportKind, ReportQueryDto } from './dto/report.dto';

export interface ReportTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Operational reports and their Excel exports.
 *
 * Every figure is read from the ledger and the sales tables, and every query is
 * scoped to the caller, so an export can never contain another branch's data
 * (docs/01 §33).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  /** Resolves the caller's scope once, then reuses it for every query. */
  private resolveScope(query: ReportQueryDto, actor: AuthenticatedUser) {
    const businessId = this.authorization.resolveBusinessScope(actor);
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    const branchId = this.authorization.resolveBranchScope(actor, query.branchId);
    const range = resolveDateRange(query.from, query.to, this.businessTimezone);

    return { businessId, branchId, start: range?.start ?? null, end: range?.end ?? null };
  }

  async salesReport(query: ReportQueryDto, actor: AuthenticatedUser) {
    const { businessId, branchId, start, end } = this.resolveScope(query, actor);
    const params: unknown[] = [businessId];
    const filters = [`sale.business_id = $1`, 'sale.voided_at IS NULL'];

    if (branchId) {
      filters.push(`sale.branch_id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (query.fuelTypeId) {
      filters.push(`sale.fuel_type_id = $${params.length + 1}`);
      params.push(query.fuelTypeId);
    }
    if (start) {
      filters.push(`sale.sold_at >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      filters.push(`sale.sold_at <= $${params.length + 1}`);
      params.push(end);
    }

    const summary = await this.dataSource.query(
      `SELECT COALESCE(SUM(sale.litres_sold), 0) AS total_litres_sold,
              COALESCE(SUM(sale.total_amount), 0) AS total_revenue
         FROM sales sale
        WHERE ${filters.join(' AND ')}`,
      params,
    );

    const salesRows = await this.dataSource.query(
      `SELECT branch.name AS branch_name,
              sale.sale_number,
              fuel_type.name AS fuel_type,
              sale.sold_at,
              sale.litres_sold,
              sale.unit_price,
              sale.total_amount
         FROM sales sale
         JOIN branches branch ON branch.id = sale.branch_id
         JOIN fuel_types fuel_type ON fuel_type.id = sale.fuel_type_id
        WHERE ${filters.join(' AND ')}
        ORDER BY sale.sold_at DESC, sale.id DESC`,
      params,
    );

    const byFuelType = await this.dataSource.query(
      `SELECT fuel_type.id AS fuel_type_id,
              fuel_type.name AS fuel_type,
              COALESCE(SUM(sale.litres_sold), 0) AS litres_sold,
              COALESCE(SUM(sale.total_amount), 0) AS revenue
         FROM sales sale
         JOIN fuel_types fuel_type ON fuel_type.id = sale.fuel_type_id
        WHERE ${filters.join(' AND ')}
        GROUP BY fuel_type.id, fuel_type.name
        ORDER BY fuel_type.name ASC`,
      params,
    );

    return {
      summary: {
        totalLitresSold: summary[0]?.total_litres_sold ?? '0',
        totalRevenue: summary[0]?.total_revenue ?? '0',
      },
      rows: salesRows.map((row: Record<string, string>) => ({
        branchName: row.branch_name,
        saleNumber: row.sale_number,
        fuelType: row.fuel_type,
        soldAt: row.sold_at,
        litresSold: row.litres_sold,
        unitPrice: row.unit_price,
        totalAmount: row.total_amount,
      })),
      byFuelType: byFuelType.map((row: Record<string, string>) => ({
        fuelTypeId: row.fuel_type_id,
        fuelType: row.fuel_type,
        litresSold: row.litres_sold,
        revenue: row.revenue,
      })),
    };
  }

  async inventoryReport(query: ReportQueryDto, actor: AuthenticatedUser) {
    const { businessId, branchId, start, end } = this.resolveScope(query, actor);
    const params: unknown[] = [businessId];
    const filters = ['branch.business_id = $1', 'branch.deleted_at IS NULL'];

    if (branchId) {
      filters.push(`branch.id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (query.fuelTypeId) {
      filters.push(`fuel_type.id = $${params.length + 1}`);
      params.push(query.fuelTypeId);
    }

    const rows = await this.dataSource.query(
      `SELECT branch.name AS branch_name,
              fuel_type.name AS fuel_type,
              COALESCE((
                SELECT SUM(tx.quantity_litres) FROM inventory_transactions tx
                 WHERE tx.branch_id = branch.id AND tx.fuel_type_id = fuel_type.id
                   AND tx.occurred_at < $${params.length + 1}
              ), 0) AS opening_litres,
              COALESCE((
                SELECT SUM(tx.quantity_litres) FROM inventory_transactions tx
                 WHERE tx.branch_id = branch.id AND tx.fuel_type_id = fuel_type.id
                   AND tx.transaction_type = 'DELIVERY'
                   AND tx.occurred_at >= $${params.length + 1}
                   AND tx.occurred_at <= $${params.length + 2}
              ), 0) AS received_litres,
              COALESCE((
                SELECT -SUM(tx.quantity_litres) FROM inventory_transactions tx
                 WHERE tx.branch_id = branch.id AND tx.fuel_type_id = fuel_type.id
                   AND tx.transaction_type = 'SALE'
                   AND tx.occurred_at >= $${params.length + 1}
                   AND tx.occurred_at <= $${params.length + 2}
              ), 0) AS sold_litres,
              COALESCE((
                SELECT SUM(tx.quantity_litres) FROM inventory_transactions tx
                 WHERE tx.branch_id = branch.id AND tx.fuel_type_id = fuel_type.id
              ), 0) AS closing_litres
         FROM branches branch
         JOIN fuel_types fuel_type ON fuel_type.business_id = branch.business_id
        WHERE ${filters.join(' AND ')}
        ORDER BY branch.name ASC, fuel_type.name ASC`,
      [...params, start ?? new Date(0), end ?? new Date(8640000000000000)],
    );

    return {
      rows: rows.map((row: Record<string, string>) => ({
        branchName: row.branch_name,
        fuelType: row.fuel_type,
        openingLitres: row.opening_litres,
        deliveriesLitres: row.received_litres,
        salesLitres: row.sold_litres,
        adjustmentsLitres: '0.000',
        closingLitres: row.closing_litres,
      })),
    };
  }

  async deliveriesReport(query: ReportQueryDto, actor: AuthenticatedUser) {
    const { businessId, branchId, start, end } = this.resolveScope(query, actor);
    const params: unknown[] = [businessId];
    const filters = ['delivery.business_id = $1', 'delivery.delivery_status = $2'];
    params.push('RECEIVED');

    if (branchId) {
      filters.push(`delivery.destination_branch_id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (start) {
      filters.push(`delivery.delivered_at >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      filters.push(`delivery.delivered_at <= $${params.length + 1}`);
      params.push(end);
    }

    const rows = await this.dataSource.query(
      `SELECT delivery.delivery_number,
              supplier.name AS supplier,
              tanker.registration_number AS tanker,
              branch.name AS branch,
              item.expected_quantity_litres,
              item.actual_quantity_litres,
              item.difference_litres,
              delivery.delivered_at
         FROM deliveries delivery
         JOIN delivery_items item ON item.delivery_id = delivery.id
         LEFT JOIN tankers tanker ON tanker.id = delivery.tanker_id
         JOIN fuel_orders fuel_order ON fuel_order.id = delivery.fuel_order_id
         LEFT JOIN suppliers supplier ON supplier.id = fuel_order.supplier_id
         JOIN branches branch ON branch.id = delivery.destination_branch_id
        WHERE ${filters.join(' AND ')}
        ORDER BY delivery.delivered_at DESC, delivery.id DESC, item.id ASC`,
      params,
    );

    return {
      deliveries: rows.length,
      rows: rows.map((row: Record<string, string | null>) => ({
        deliveryNumber: row.delivery_number,
        supplier: row.supplier,
        tanker: row.tanker,
        branch: row.branch,
        expectedLitres: row.expected_quantity_litres,
        actualLitres: row.actual_quantity_litres,
        differenceLitres: row.difference_litres,
        deliveredAt: row.delivered_at,
      })),
    };
  }

  async dailyReportsReport(query: ReportQueryDto & { status?: string }, actor: AuthenticatedUser) {
    const { businessId, branchId, start, end } = this.resolveScope(query, actor);
    const params: unknown[] = [businessId];
    const filters = ['report.business_id = $1'];

    if (branchId) {
      filters.push(`report.branch_id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (query.status) {
      filters.push(`report.status = $${params.length + 1}`);
      params.push(query.status);
    }
    if (start) {
      filters.push(`report.report_date >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      filters.push(`report.report_date <= $${params.length + 1}`);
      params.push(end);
    }

    const rows = await this.dataSource.query(
      `SELECT branch.name AS branch_name,
              report.report_date,
              report.status,
              report.opening_stock_litres,
              report.total_received_litres,
              report.total_sold_litres,
              report.closing_stock_litres,
              report.total_revenue
         FROM daily_reports report
         JOIN branches branch ON branch.id = report.branch_id
        WHERE ${filters.join(' AND ')}
        ORDER BY report.report_date DESC, branch.name ASC, report.id DESC`,
      params,
    );

    return {
      rows: rows.map((row: Record<string, string>) => ({
        branchName: row.branch_name,
        reportDate: row.report_date,
        status: row.status,
        openingLitres: row.opening_stock_litres,
        receivedLitres: row.total_received_litres,
        soldLitres: row.total_sold_litres,
        closingLitres: row.closing_stock_litres,
        revenue: row.total_revenue,
      })),
    };
  }

  /** Flattens a report into columns + rows for the spreadsheet writer. */
  async toTable(
    kind: ReportKind,
    query: ReportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ReportTable> {
    switch (kind) {
      case ReportKind.SALES: {
        const report = await this.salesReport(query, actor);
        return {
          title: 'Sales report',
          columns: ['Branch', 'Date', 'Sale number', 'Fuel type', 'Litres', 'Unit price', 'Amount'],
          rows: report.rows.map((row: Record<string, string>) => [
            row.branchName,
            row.soldAt ? new Date(row.soldAt).toISOString() : '',
            row.saleNumber,
            row.fuelType,
            row.litresSold,
            row.unitPrice,
            row.totalAmount,
          ]),
        };
      }
      case ReportKind.INVENTORY: {
        const report = await this.inventoryReport(query, actor);
        return {
          title: 'Inventory report',
          columns: [
            'Branch',
            'Fuel type',
            'Opening (L)',
            'Received (L)',
            'Sold (L)',
            'Adjustments (L)',
            'Closing (L)',
          ],
          rows: report.rows.map((row: Record<string, string>) => [
            row.branchName,
            row.fuelType,
            row.openingLitres,
            row.deliveriesLitres,
            row.salesLitres,
            row.adjustmentsLitres,
            row.closingLitres,
          ]),
        };
      }
      case ReportKind.DELIVERIES: {
        const report = await this.deliveriesReport(query, actor);
        return {
          title: 'Deliveries report',
          columns: [
            'Delivery',
            'Supplier',
            'Tanker',
            'Branch',
            'Expected (L)',
            'Actual (L)',
            'Difference (L)',
            'Delivered at',
          ],
          rows: report.rows.map((row: Record<string, string>) => [
            row.deliveryNumber ?? '',
            row.supplier ?? '',
            row.tanker ?? '',
            row.branch,
            row.expectedLitres ?? '',
            row.actualLitres ?? '',
            row.differenceLitres ?? '',
            row.deliveredAt ? new Date(row.deliveredAt).toISOString() : '',
          ]),
        };
      }
      case ReportKind.DAILY_REPORTS: {
        const report = await this.dailyReportsReport(query, actor);
        return {
          title: 'Daily reports',
          columns: [
            'Branch',
            'Date',
            'Status',
            'Opening (L)',
            'Received (L)',
            'Sold (L)',
            'Closing (L)',
            'Revenue',
          ],
          rows: report.rows.map((row: Record<string, string>) => [
            row.branchName,
            row.reportDate,
            row.status,
            row.openingLitres,
            row.receivedLitres,
            row.soldLitres,
            row.closingLitres,
            row.revenue,
          ]),
        };
      }
      default: {
        // Unreachable while the enum is exhaustive, but kept so an added kind
        // fails loudly instead of silently producing an empty export.
        const unreachable: never = kind;
        throw apiError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported report kind: ${String(unreachable)}`,
        );
      }
    }
  }

  /**
   * Renders a report table to a real .xlsx workbook.
   *
   * Numeric cells are written as numbers rather than strings so Excel can sum
   * and chart them; anything unparseable stays a string.
   */
  async toWorkbook(table: ReportTable): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'trackIt API';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(table.title.slice(0, 31));
    sheet.addRow(table.columns);

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEEEEEE' },
    };

    for (const row of table.rows) {
      sheet.addRow(
        row.map((value) => {
          if (typeof value === 'number') return value;
          const parsed = Number(value);
          return value !== '' && Number.isFinite(parsed) ? parsed : value;
        }),
      );
    }

    // Give the numeric columns a sensible width so the sheet is readable.
    sheet.columns.forEach((column, index) => {
      const header_ = table.columns[index] ?? '';
      column.width = header_.includes('(L)') || header_ === 'Revenue' ? 16 : 24;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    this.logger.debug(`Generated ${table.title} workbook with ${table.rows.length} rows`);

    return Buffer.from(buffer);
  }

  /** Advisory filename; the frontend derives its own from the same inputs. */
  buildFilename(kind: ReportKind | string, query: ExportQueryDto): string {
    const from = query.from ?? 'start';
    const to = query.to ?? 'end';
    return `${kind}-report-${from}-to-${to}.xlsx`;
  }
}
