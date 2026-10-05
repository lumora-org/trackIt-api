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
import { SalesService } from './sales.service';
import { CreateSaleDto, ListSalesQueryDto, VoidSaleDto } from './dto/sale.dto';
import { SaleResponseDto } from './dto/sale-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('sales')
@ApiBearerAuth('access-token')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @ApiOperation({
    summary: 'List sales',
    description: 'A MANAGER sees only sales recorded against their own branch.',
  })
  @ApiOkResponse({ type: SaleResponseDto, isArray: true })
  async findAll(
    @Query() query: ListSalesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<SaleResponseDto>> {
    return this.sales.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one sale' })
  @ApiOkResponse({ type: SaleResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SaleResponseDto> {
    const sale = await this.sales.findOneOrFail(id, actor);
    return this.sales.toResponse(sale);
  }

  @Post()
  @Roles(UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'Record a sale',
    description:
      'Takes only branchId, fuelTypeId, litresSold and soldAt — there is no ' +
      'unitPrice or totalAmount input. The backend resolves the price ' +
      'applicable at soldAt (422 INVALID_FUEL_PRICE if none), snapshots it ' +
      'onto the sale, computes the total, and posts a negative SALE row to ' +
      'the ledger in the same transaction. An oversell is rejected with 422 ' +
      'INSUFFICIENT_INVENTORY.',
  })
  @ApiCreatedResponse({ type: SaleResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SaleResponseDto> {
    return this.sales.create(dto, actor, { userId: actor.id });
  }

  @Post(':id/void')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Void a sale',
    description:
      'The sale row is never deleted. Stock is restored with a CORRECTION ' +
      'ledger row carrying +litresSold, so the ledger keeps showing both the ' +
      'sale and its reversal. Re-voiding returns 422 INVALID_OPERATION.',
  })
  @ApiOkResponse({ type: SaleResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SaleResponseDto> {
    return this.sales.void(id, dto, actor, { userId: actor.id });
  }
}
