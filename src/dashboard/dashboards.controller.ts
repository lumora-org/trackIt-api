import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardsService } from './dashboards.service';
import {
  AdminDashboardDto,
  AdminDashboardQueryDto,
  ManagerDashboardDto,
} from './dto/dashboard.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('admin')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Business-wide operational overview',
    description:
      'Branch count, fuel received and sold, revenue and per-branch ' +
      'performance. from/to narrow the movement and revenue window; current ' +
      'stock figures are always current. A branchId narrows the overview — ' +
      'summary figures and the branch list — to that one branch; a ' +
      'manager-scoped branch filter is clamped to the caller.',
  })
  @ApiOkResponse({ type: AdminDashboardDto })
  async admin(
    @Query() query: AdminDashboardQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminDashboardDto> {
    return this.dashboards.adminDashboard(query, actor);
  }

  @Get('manager')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'The caller own branch overview',
    description:
      "Automatically scoped to the manager's branch: current stock, today's " +
      "litres sold and revenue, and today's report status or null.",
  })
  @ApiOkResponse({ type: ManagerDashboardDto })
  async manager(@CurrentUser() actor: AuthenticatedUser): Promise<ManagerDashboardDto> {
    return this.dashboards.managerDashboard(actor);
  }
}
