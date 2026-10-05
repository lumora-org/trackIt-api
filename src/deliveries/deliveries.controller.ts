import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveriesService } from './deliveries.service';
import { ListDeliveriesQueryDto } from './dto/delivery.dto';
import { DeliveryResponseDto } from './dto/delivery-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

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
}
