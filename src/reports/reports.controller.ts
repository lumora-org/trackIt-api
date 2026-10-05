import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { ExportAuthGuard } from '../auth/guards/export-auth.guard';
import { ReportsService } from './reports.service';
import { ExportQueryDto, ReportKind, ReportQueryDto } from './dto/report.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';
import { apiError } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Sales report: totals and a breakdown by fuel type' })
  @ApiOkResponse({ description: 'Summary plus per-sale rows and per-fuel aggregates' })
  async sales(@Query() query: ReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.salesReport(query, actor);
  }

  @Get('inventory')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Inventory report',
    description: 'Opening, deliveries, sales, adjustments and closing per branch and fuel type.',
  })
  async inventory(@Query() query: ReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.inventoryReport(query, actor);
  }

  @Get('deliveries')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delivery report',
    description: 'Supplier, tanker, expected, actual and difference per delivered line.',
  })
  async deliveries(@Query() query: ReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.deliveriesReport(query, actor);
  }

  @Get('daily-reports')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Daily report figures across branches' })
  async dailyReports(@Query() query: ReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.dailyReportsReport(query, actor);
  }

  /**
   * Excel download.
   *
   * The frontend downloads by navigating the browser, which cannot carry the
   * in-memory Authorization header (PROMPT-B.E §6.2). This implements option
   * (a) of that decision list: ExportAuthGuard accepts the httpOnly refresh
   * cookie on this route only, alongside the normal bearer token. Every other
   * endpoint still requires the bearer token alone.
   */
  @Get(':kind/export')
  @UseGuards(ExportAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Download a report as .xlsx',
    description:
      'Accepts the normal bearer token, or the httpOnly refresh cookie so a ' +
      'plain browser navigation can download the file.',
  })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'The generated workbook' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async export(
    @Param('kind') kindParam: string,
    @Query() query: ExportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const kind = this.parseKind(kindParam);

    const table = await this.reports.toTable(kind, query, actor);
    const buffer = await this.reports.toWorkbook(table);
    const filename = this.reports.buildFilename(kind, query);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  private parseKind(value: string): ReportKind {
    const match = Object.values(ReportKind).find((candidate) => candidate === value);
    if (!match) {
      throw apiError(ErrorCode.VALIDATION_ERROR, `Unsupported report kind: ${value}.`, [
        { field: 'kind', message: `must be one of ${Object.values(ReportKind).join(', ')}` },
      ]);
    }
    return match;
  }
}
