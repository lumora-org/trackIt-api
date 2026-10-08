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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { CreateIncidentReportDto, ListIncidentReportsQueryDto } from './dto/incident-report.dto';
import { IncidentReportResponseDto } from './dto/incident-report-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('incident-reports')
@ApiBearerAuth('access-token')
@Controller('incident-reports')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List incident reports',
    description: 'A MANAGER sees only incidents recorded for their own branch.',
  })
  @ApiOkResponse({ type: IncidentReportResponseDto, isArray: true })
  async findAll(
    @Query() query: ListIncidentReportsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<IncidentReportResponseDto>> {
    return this.incidents.findAll(query, actor);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Read one incident report' })
  @ApiOkResponse({ type: IncidentReportResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<IncidentReportResponseDto> {
    const report = await this.incidents.findOneOrFail(id, actor);
    return this.incidents.toResponse(report);
  }

  @Post()
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'Report an incident',
    description:
      'Free-text exception log for the branch — stock variances, government ' +
      'vehicles collecting fuel without paying, equipment failures. The day ' +
      'defaults to today in the business timezone; future dates are rejected. ' +
      'The business admins are notified in the same transaction.',
  })
  @ApiCreatedResponse({ type: IncidentReportResponseDto })
  async create(
    @Body() dto: CreateIncidentReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<IncidentReportResponseDto> {
    return this.incidents.create(dto, actor, { userId: actor.id });
  }

  @Post(':id/review')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acknowledge an incident',
    description:
      'Flips OPEN -> REVIEWED once and notifies the reporter. Re-reviewing ' +
      'returns 422 INVALID_OPERATION.',
  })
  @ApiOkResponse({ type: IncidentReportResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<IncidentReportResponseDto> {
    return this.incidents.review(id, actor, { userId: actor.id });
  }
}
