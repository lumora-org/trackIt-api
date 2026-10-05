import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, ListSuppliersQueryDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SupplierResponseDto } from './dto/supplier-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('suppliers')
@ApiBearerAuth('access-token')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'List the suppliers of the caller business' })
  @ApiOkResponse({ type: SupplierResponseDto, isArray: true })
  async findAll(
    @Query() query: ListSuppliersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<SupplierResponseDto>> {
    return this.suppliers.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one supplier' })
  @ApiOkResponse({ type: SupplierResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.suppliers.findOneOrFail(id, actor);
    return this.suppliers.toResponse(supplier);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Register a supplier',
    description: 'code is unique per business; duplicates answer 409.',
  })
  @ApiCreatedResponse({ type: SupplierResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SupplierResponseDto> {
    const created = await this.suppliers.create(dto, actor, { userId: actor.id });
    return this.suppliers.toResponse(created);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a supplier, including deactivation' })
  @ApiOkResponse({ type: SupplierResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SupplierResponseDto> {
    const updated = await this.suppliers.update(id, dto, actor, { userId: actor.id });
    return this.suppliers.toResponse(updated);
  }
}
