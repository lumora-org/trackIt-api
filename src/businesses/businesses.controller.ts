import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto, ListBusinessesQueryDto } from './dto/business.dto';
import { BusinessResponseDto } from './dto/business-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { auditActorFromRequest } from '../common/utils/request.util';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('businesses')
@ApiBearerAuth('access-token')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List every business on the platform' })
  @ApiOkResponse({ type: BusinessResponseDto, isArray: true })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async findAll(
    @Query() query: ListBusinessesQueryDto,
  ): Promise<PaginatedResult<BusinessResponseDto>> {
    return this.businesses.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one business',
    description:
      'An ADMIN or MANAGER may read only their own business; a foreign id ' +
      'answers 404 so tenant membership cannot be probed.',
  })
  @ApiOkResponse({ type: BusinessResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponse })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BusinessResponseDto> {
    const business = await this.businesses.findOneOrFail(id, actor);
    return this.businesses.toResponse(business);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Onboard a business account' })
  @ApiCreatedResponse({ type: BusinessResponseDto })
  async create(
    @Body() dto: CreateBusinessDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<BusinessResponseDto> {
    const business = await this.businesses.create(dto, actor, auditActorFromRequest(req));
    return this.businesses.toResponse(business);
  }
}
