import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { AppNotificationDto, ReadAllResultDto } from './dto/notification-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

/**
 * Declared before the `:id` route on purpose: `read-all` must never be
 * captured as an id (docs/04 §74).
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every unread notification of the caller as read' })
  @ApiOkResponse({ type: ReadAllResultDto })
  async markAllRead(@CurrentUser() actor: AuthenticatedUser): Promise<ReadAllResultDto> {
    return { updated: await this.notifications.markAllRead(actor.id) };
  }

  @Get()
  @ApiOperation({
    summary: 'List the caller notifications',
    description:
      'Recipient is always the authenticated user. The unread badge polls ' +
      '?status=UNREAD&limit=1 and reads meta.total, so the pagination envelope ' +
      'is required here.',
  })
  @ApiOkResponse({ type: AppNotificationDto, isArray: true })
  async findAll(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<AppNotificationDto>> {
    return this.notifications.findForRecipient(query, actor.id);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark one notification read',
    description: 'Another user notification id answers 404, never someone else data.',
  })
  @ApiOkResponse({ type: AppNotificationDto })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AppNotificationDto> {
    return this.notifications.markRead(id, actor.id);
  }
}
