import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogsQueryService } from './audit-logs-query.service';
import { AuditLogResponseDto, ListAuditLogsQueryDto } from './dto/audit-log.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

/**
 * Strictly read-only by design: there is no POST, PATCH or DELETE here. Audit
 * rows are appended by domain services and can never be edited (docs/03 §62).
 */
@ApiTags('audit-logs')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit entries',
    description:
      'An ADMIN sees only its own business; a SUPER_ADMIN sees everything. ' +
      'A MANAGER has no audit access. Newest first.',
  })
  @ApiOkResponse({ type: AuditLogResponseDto, isArray: true })
  async findAll(
    @Query() query: ListAuditLogsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<AuditLogResponseDto>> {
    return this.auditLogs.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one audit entry' })
  @ApiOkResponse({ type: AuditLogResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AuditLogResponseDto> {
    const row = await this.auditLogs.findOneOrFail(id, actor);
    return this.auditLogs.toResponse(row);
  }
}
