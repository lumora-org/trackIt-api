import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import {
  CreateAdjustmentDto,
  ListInventoryQueryDto,
  ListInventoryTransactionsQueryDto,
} from './dto/inventory.dto';
import {
  InventoryStockDto,
  InventorySummaryDto,
  InventoryTransactionResponseDto,
} from './dto/inventory-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RawResponse } from '../common/interceptors/transform.interceptor';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('inventory')
@ApiBearerAuth('access-token')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RawResponse()
  @ApiOperation({
    summary: 'Current stock per branch and fuel type',
    description:
      'Returns a bare array, not the usual { data } envelope — the documented ' +
      'exception in PROMPT-B.E §2.2. A MANAGER is clamped to their own branch.',
  })
  @ApiOkResponse({ type: InventoryStockDto, isArray: true })
  async currentStock(
    @Query() query: ListInventoryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InventoryStockDto[]> {
    return this.inventory.currentStockMatrix(query, actor);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Stock rolled up per fuel type' })
  @ApiOkResponse({ type: InventorySummaryDto })
  async summary(
    @Query() query: ListInventoryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InventorySummaryDto> {
    return this.inventory.summary(query.branchId ?? null, actor);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'The inventory ledger',
    description:
      'Append-only history, newest first. Nothing in this API edits or deletes ' +
      'a row; corrections arrive as new CORRECTION entries.',
  })
  @ApiOkResponse({ type: InventoryTransactionResponseDto, isArray: true })
  async findTransactions(
    @Query() query: ListInventoryTransactionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<InventoryTransactionResponseDto>> {
    return this.inventory.findTransactions(query, actor);
  }

  @Post('adjustments')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'Record a manual stock adjustment',
    description:
      'Appends one signed ADJUSTMENT row with a mandatory reason. It never ' +
      'modifies a historical transaction. An adjustment that would take stock ' +
      'below zero is rejected with 422 INSUFFICIENT_INVENTORY.',
  })
  @ApiCreatedResponse({ type: InventoryTransactionResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async adjust(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InventoryTransactionResponseDto> {
    const row = await this.inventory.adjust(dto, actor, { userId: actor.id });
    return this.inventory.toResponse(row);
  }
}
