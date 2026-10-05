import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchResponseDto } from './dto/branch-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('branches')
@ApiBearerAuth('access-token')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({
    summary: 'List branches visible to the caller',
    description:
      'ADMIN sees its own business, MANAGER sees only the branch assigned to ' +
      'it, SUPER_ADMIN sees all. A branchId filter is clamped to the caller ' +
      'scope, never trusted.',
  })
  @ApiOkResponse({ type: BranchResponseDto, isArray: true })
  async findAll(
    @Query() query: ListBranchesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<BranchResponseDto>> {
    return this.branches.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one branch' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.findOneOrFail(id, actor);
    return this.branches.toResponse(branch);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create a branch',
    description:
      'businessId is always derived from the caller. A SUPER_ADMIN has no ' +
      'business of their own, so the target must be supplied explicitly.',
  })
  @ApiCreatedResponse({ type: BranchResponseDto })
  async create(
    @Body() dto: CreateBranchDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.create(dto, actor, { userId: actor.id });
    return this.branches.toResponse(branch);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update a branch, including activation and deactivation',
    description:
      'There is deliberately no separate status endpoint; sending ' +
      '`status` here is how a branch is activated or deactivated.',
  })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.update(id, dto, actor, { userId: actor.id });
    return this.branches.toResponse(branch);
  }
}
