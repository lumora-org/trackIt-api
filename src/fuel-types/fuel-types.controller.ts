import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FuelTypesService } from './fuel-types.service';
import { CreateFuelTypeDto, ListFuelTypesQueryDto, UpdateFuelTypeDto } from './dto/fuel-type.dto';
import { FuelTypeResponseDto } from './dto/fuel-type-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('fuel-types')
@ApiBearerAuth('access-token')
@Controller('fuel-types')
export class FuelTypesController {
  constructor(private readonly fuelTypes: FuelTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List the fuel types of the caller business' })
  @ApiOkResponse({ type: FuelTypeResponseDto, isArray: true })
  async findAll(
    @Query() query: ListFuelTypesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelTypeResponseDto>> {
    return this.fuelTypes.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one fuel type' })
  @ApiOkResponse({ type: FuelTypeResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelTypeResponseDto> {
    const fuelType = await this.fuelTypes.findOneOrFail(id, actor);
    return this.fuelTypes.toResponse(fuelType);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create a fuel type',
    description: 'code is unique per business and immutable once created.',
  })
  @ApiCreatedResponse({ type: FuelTypeResponseDto })
  async create(
    @Body() dto: CreateFuelTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelTypeResponseDto> {
    const created = await this.fuelTypes.create(dto, actor, { userId: actor.id });
    return this.fuelTypes.toResponse(created);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update a fuel type',
    description:
      'code is not accepted here; historical records reference it. ' +
      'Sending status is how a grade is deactivated.',
  })
  @ApiOkResponse({ type: FuelTypeResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFuelTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelTypeResponseDto> {
    const updated = await this.fuelTypes.update(id, dto, actor, { userId: actor.id });
    return this.fuelTypes.toResponse(updated);
  }
}
