import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TankersService } from './tankers.service';
import { CreateTankerDto, ListTankersQueryDto, UpdateTankerDto } from './dto/tanker.dto';
import { TankerResponseDto } from './dto/tanker-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('tankers')
@ApiBearerAuth('access-token')
@Controller('tankers')
export class TankersController {
  constructor(private readonly tankers: TankersService) {}

  @Get()
  @ApiOperation({ summary: 'List the tanker fleet of the caller business' })
  @ApiOkResponse({ type: TankerResponseDto, isArray: true })
  async findAll(
    @Query() query: ListTankersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<TankerResponseDto>> {
    return this.tankers.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one tanker' })
  @ApiOkResponse({ type: TankerResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TankerResponseDto> {
    const tanker = await this.tankers.findOneOrFail(id, actor);
    return this.tankers.toResponse(tanker);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Register a tanker',
    description:
      'Registration numbers are unique per business, compared ' +
      'case-insensitively. capacityLitres must be greater than 0, which the ' +
      'database CHECK also enforces.',
  })
  @ApiCreatedResponse({ type: TankerResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateTankerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TankerResponseDto> {
    const created = await this.tankers.create(dto, actor, { userId: actor.id });
    return this.tankers.toResponse(created);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a tanker, including deactivation' })
  @ApiOkResponse({ type: TankerResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTankerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TankerResponseDto> {
    const updated = await this.tankers.update(id, dto, actor, { userId: actor.id });
    return this.tankers.toResponse(updated);
  }
}
