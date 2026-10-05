import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { DailyReportsService } from './daily-reports.service';
import {
  CreateDailyReportDto,
  ListDailyReportsQueryDto,
  RejectDailyReportDto,
} from './dto/daily-report.dto';
import { DailyReportResponseDto } from './dto/daily-report-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('daily-reports')
@ApiBearerAuth('access-token')
@Controller('daily-reports')
export class DailyReportsController {
  constructor(private readonly reports: DailyReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'List daily reports',
    description: 'A MANAGER sees only reports for their own branch.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto, isArray: true })
  async findAll(
    @Query() query: ListDailyReportsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<DailyReportResponseDto>> {
    return this.reports.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one daily report',
    description: 'A manager reaching another branch report is BRANCH_ACCESS_DENIED.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.findOneOrFail(id, actor);
    return this.reports.toResponse(report);
  }

  @Post()
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Generate a daily report',
    description:
      'Every figure is computed from the ledger and the sales table, so ' +
      'opening + received - sold always equals closing. The client cannot ' +
      'submit totals. This writes NO inventory transactions. A future date is ' +
      'refused, and a second report for the same branch and date answers 409 ' +
      'REPORT_ALREADY_EXISTS.',
  })
  @ApiCreatedResponse({ type: DailyReportResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateDailyReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.create(dto, actor, { userId: actor.id });
    return this.reports.toResponse(report);
  }

  @Post(':id/submit')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'DRAFT → SUBMITTED',
    description:
      'Figures are recomputed at submission so the reviewed numbers are ' +
      'current, then the business admins are notified.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'REPORT_NOT_SUBMITTABLE when the report is not a draft',
  })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.submit(id, actor, { userId: actor.id });
    return this.reports.toResponse(report);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SUBMITTED → APPROVED',
    description:
      'Records the reviewer, notifies the author, and refuses self-approval ' +
      'so nobody signs off their own report.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'REPORT_NOT_APPROVABLE when the report is not awaiting review',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.approve(id, actor, { userId: actor.id });
    return this.reports.toResponse(report);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SUBMITTED → REJECTED',
    description:
      'A reason is mandatory and is stored on the report. The author is ' +
      'notified so they can correct and resubmit.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDailyReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.reject(id, dto, actor, { userId: actor.id });
    return this.reports.toResponse(report);
  }

  @Post(':id/resubmit')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'REJECTED → DRAFT',
    description:
      'Returns the report to DRAFT rather than straight to SUBMITTED, so the ' +
      'manager can correct it first. Figures are refreshed from the ledger.',
  })
  @ApiOkResponse({ type: DailyReportResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DailyReportResponseDto> {
    const report = await this.reports.resubmit(id, actor, { userId: actor.id });
    return this.reports.toResponse(report);
  }
}
