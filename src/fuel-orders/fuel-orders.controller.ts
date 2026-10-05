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
import { FuelOrdersService } from './fuel-orders.service';
import {
  CancelFuelOrderDto,
  CreateFuelOrderDto,
  ListFuelOrdersQueryDto,
} from './dto/fuel-order.dto';
import { FuelOrderResponseDto } from './dto/fuel-order-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { FuelOrderStatus } from '../common/enums/fuel.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('fuel-orders')
@ApiBearerAuth('access-token')
@Controller('fuel-orders')
export class FuelOrdersController {
  constructor(private readonly fuelOrders: FuelOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List fuel orders',
    description: 'A MANAGER sees only orders whose destination is their own branch.',
  })
  @ApiOkResponse({ type: FuelOrderResponseDto, isArray: true })
  async findAll(
    @Query() query: ListFuelOrdersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelOrderResponseDto>> {
    return this.fuelOrders.findAll(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one fuel order with its items' })
  @ApiOkResponse({ type: FuelOrderResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.findOneOrFail(id, actor);
    return this.fuelOrders.toResponse(order);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'Create a fuel order',
    description:
      'Always created as DRAFT. An order is a procurement commitment and never ' +
      'changes inventory — stock moves only when a delivery is received. ' +
      'unitCost is the procurement cost per litre, never the retail price.',
  })
  @ApiCreatedResponse({ type: FuelOrderResponseDto })
  async create(
    @Body() dto: CreateFuelOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.create(dto, actor, { userId: actor.id });
    return this.fuelOrders.toResponse(order);
  }

  @Post(':id/submit')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({ summary: 'DRAFT → SUBMITTED' })
  @ApiOkResponse({ type: FuelOrderResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'INVALID_ORDER_STATUS when the transition is not legal',
  })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.transition(id, FuelOrderStatus.SUBMITTED, actor, {
      userId: actor.id,
    });
    return this.fuelOrders.toResponse(order);
  }

  @Post(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({ summary: 'SUBMITTED → CONFIRMED' })
  @ApiOkResponse({ type: FuelOrderResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.transition(id, FuelOrderStatus.CONFIRMED, actor, {
      userId: actor.id,
    });
    return this.fuelOrders.toResponse(order);
  }

  @Post(':id/in-transit')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'CONFIRMED → IN_TRANSIT',
    description:
      'Creates the PENDING delivery that the destination branch manager ' +
      'receives. This is the point at which fuel becomes physically receivable.',
  })
  @ApiOkResponse({ type: FuelOrderResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async markInTransit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.transition(id, FuelOrderStatus.IN_TRANSIT, actor, {
      userId: actor.id,
    });
    return this.fuelOrders.toResponse(order);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a fuel order',
    description: 'Legal only from DRAFT, SUBMITTED or CONFIRMED, and a reason is required.',
  })
  @ApiOkResponse({ type: FuelOrderResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFuelOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelOrderResponseDto> {
    const order = await this.fuelOrders.cancel(id, dto, actor, { userId: actor.id });
    return this.fuelOrders.toResponse(order);
  }
}
