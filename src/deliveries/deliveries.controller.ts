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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { DeliveriesService } from './deliveries.service';
import { ListDeliveriesQueryDto } from './dto/delivery.dto';
import { DisputeDeliveryDto, ReceiveDeliveryDto } from './dto/receive-delivery.dto';
import { DeliveryResponseDto } from './dto/delivery-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('deliveries')
@ApiBearerAuth('access-token')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List deliveries',
    description:
      'Deliveries are created by the backend when an order goes in transit. ' +
      'A MANAGER sees only deliveries bound for their own branch.',
  })
  @ApiOkResponse({ type: DeliveryResponseDto, isArray: true })
  async findAll(
    @Query() query: ListDeliveriesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<DeliveryResponseDto>> {
    const result = await this.deliveries.findAll(query, actor);
    return PaginatedResult.of(result.items, result.total, result.page, result.limit);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one delivery',
    description: 'Includes the tanker and parent order for the receiving screen.',
  })
  @ApiOkResponse({ type: DeliveryResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.findOneOrFail(id, actor);
    return this.deliveries.toResponse(delivery);
  }

  @Post(':id/receive')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a delivery into branch inventory',
    description:
      'The authoritative inventory movement. Only actualQuantityLitres is ' +
      'posted; the expected quantity never changes stock. differenceLitres is ' +
      'derived as actual - expected, so a negative value is a shortage. The ' +
      'whole operation runs in one transaction and requires the delivery to ' +
      'still be PENDING.',
  })
  @ApiOkResponse({ type: DeliveryResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'INVALID_DELIVERY_STATUS or INVALID_DELIVERY_QUANTITY',
  })
  async receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveDeliveryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DeliveryResponseDto> {
    return this.deliveries.receive(id, dto, actor, { userId: actor.id });
  }

  @Post(':id/dispute')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispute a delivery',
    description:
      'Moves the delivery to DISPUTED with no inventory movement, because ' +
      'receiving is what posts stock. A reason is mandatory.',
  })
  @ApiOkResponse({ type: DeliveryResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async dispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeDeliveryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DeliveryResponseDto> {
    return this.deliveries.dispute(id, dto, actor, { userId: actor.id });
  }
}
