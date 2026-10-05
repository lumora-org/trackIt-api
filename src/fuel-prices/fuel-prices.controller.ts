import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FuelPricesService } from './fuel-prices.service';
import { CreateFuelPriceDto, ListFuelPricesQueryDto } from './dto/fuel-price.dto';
import { CurrentFuelPriceDto, FuelPriceResponseDto } from './dto/fuel-price-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('fuel-prices')
@ApiBearerAuth('access-token')
@Controller('fuel-prices')
export class FuelPricesController {
  constructor(private readonly fuelPrices: FuelPricesService) {}

  @Get()
  @ApiOperation({
    summary: 'List price intervals',
    description:
      'Sorted newest first. `active=true` returns only the intervals that ' +
      'contain the current instant; from/to drive the history view.',
  })
  @ApiOkResponse({ type: FuelPriceResponseDto, isArray: true })
  async findAll(
    @Query() query: ListFuelPricesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelPriceResponseDto>> {
    return this.fuelPrices.findAll(query, actor);
  }

  @Get('current/:fuelTypeId')
  @ApiOperation({
    summary: 'Read the currently active price for a fuel type',
    description: 'Answers 404 when no interval applies right now.',
  })
  @ApiOkResponse({ type: CurrentFuelPriceDto })
  async findCurrent(
    @Param('fuelTypeId', ParseUUIDPipe) fuelTypeId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CurrentFuelPriceDto> {
    return this.fuelPrices.findCurrentOrFail(fuelTypeId, actor);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set a new price period',
    description:
      'Creates a new interval and closes the previous open one in the same ' +
      'transaction, so the fuel is never left without a valid price. ' +
      'Periods are half-open [from, to): the new price takes effect exactly at ' +
      'effectiveFrom. Overlaps are rejected with 422 INVALID_FUEL_PRICE.',
  })
  @ApiCreatedResponse({ type: FuelPriceResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateFuelPriceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FuelPriceResponseDto> {
    const created = await this.fuelPrices.create(dto, actor, { userId: actor.id });
    return this.fuelPrices.toResponse(created);
  }
}
