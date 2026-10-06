import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateAvatarDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List users',
    description: 'A MANAGER cannot list users. An ADMIN sees only its own business.',
  })
  @ApiOkResponse({ type: UserResponseDto, isArray: true })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async findAll(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<UserResponseDto>> {
    return this.users.findAll(query, actor);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Read one user' })
  @ApiOkResponse({ type: UserResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.users.findOneScopedOrFail(id, actor);
    return this.users.toResponse(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create a manager or admin',
    description:
      'businessId is derived from the caller. MANAGER requires branchId and ' +
      'that branch must belong to the caller business; ADMIN must not carry ' +
      'one. A SUPER_ADMIN must name the target business explicitly.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse, description: 'Email already exists' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const created = await this.users.create(dto, actor, { userId: actor.id });
    return this.users.toResponse(created);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update a user',
    description:
      'email and role are immutable here and are rejected by the validation ' +
      'pipe. Editing yourself returns 422 INVALID_OPERATION; a SUPER_ADMIN ' +
      'target returns 403.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const updated = await this.users.update(id, dto, actor, { userId: actor.id });
    return this.users.toResponse(updated);
  }

  @Patch(':id/status')
  // Product decision: suspending accounts is a business-admin duty; the
  // platform role manages businesses only.
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Activate, deactivate or suspend an account (ADMIN only)',
    description:
      'Leaving ACTIVE revokes every refresh session for that account so the ' +
      'change takes effect immediately.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const updated = await this.users.updateStatus(id, dto.status, actor, { userId: actor.id });
    return this.users.toResponse(updated);
  }

  @Delete(':id')
  // Product decision: removing accounts is a business-admin duty.
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Soft-remove a user (ADMIN only)',
    description:
      'A deliberate extension beyond docs/04 required by the Users page. ' +
      'Suspension via PATCH /users/:id/status remains the recommended flow.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.users.remove(id, actor, { userId: actor.id });
  }
}

/**
 * Self-service routes. Declared on a separate controller so `/users/me/avatar`
 * can never be captured by `/users/:id`.
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users/me')
export class MyProfileController {
  constructor(private readonly users: UsersService) {}

  @Post('avatar')
  @ApiOperation({
    summary: 'Set or clear the signed-in user avatar',
    description:
      'Accepts a base64 png/jpeg/webp data URL, matching what the frontend ' +
      'already sends, so no frontend change is needed. Send null to remove ' +
      'the avatar.',
  })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  async updateAvatar(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateAvatarDto,
  ): Promise<AuthenticatedUserDto> {
    const updated = await this.users.updateAvatar(actor.id, dto.avatarUrl ?? null);
    return this.users.toAuthenticatedUser(updated);
  }
}
