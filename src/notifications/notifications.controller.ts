import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import {
  PushStatusDto,
  RegisterPushSubscriptionDto,
  RegisteredPushSubscriptionDto,
  TestPushResultDto,
} from './dto/push.dto';
import { AppNotificationDto, ReadAllResultDto } from './dto/notification-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

/**
 * Declared before the `:id` route on purpose: `read-all` must never be
 * captured as an id (docs/04 §74). The same rule puts every `push/...` route
 * above `:id/read` below.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

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

  @Get('push')
  @ApiOperation({
    summary: 'Web Push status for the caller',
    description:
      'Reports whether the server can deliver push at all, the VAPID key the ' +
      'browser needs for PushManager.subscribe(), and the devices already ' +
      'registered. Subscription endpoints and encryption keys are never returned.',
  })
  @ApiOkResponse({ type: PushStatusDto })
  async pushStatus(@CurrentUser() actor: AuthenticatedUser): Promise<PushStatusDto> {
    return this.push.getStatus(actor.id);
  }

  @Post('push/subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register this device for push alerts',
    description:
      'Idempotent on the subscription endpoint: a re-register updates and ' +
      're-claims the existing row instead of duplicating it.',
  })
  @ApiOkResponse({ type: RegisteredPushSubscriptionDto })
  async registerPushSubscription(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: RegisterPushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<RegisteredPushSubscriptionDto> {
    return this.push.register(actor.id, body, userAgent?.slice(0, 255) ?? null);
  }

  /**
   * Declared before `push/subscriptions/:id` for the same static-vs-param
   * reason as `read-all`: `all` must not parse as a UUID.
   */
  @Delete('push/subscriptions/all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister every device of the caller',
    description: 'Used on sign-out so a shared device stops alerting the person who left.',
  })
  async unregisterAllPushSubscriptions(@CurrentUser() actor: AuthenticatedUser): Promise<void> {
    await this.push.unregisterAllForUser(actor.id);
  }

  @Delete('push/subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister one device',
    description: 'Another user subscription id deletes nothing and still answers 204.',
  })
  async unregisterPushSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.push.unregister(actor.id, id);
  }

  @Post('push/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a test alert to the caller devices',
    description:
      'Verifies the opt-in end to end. No notifications row is written, so the ' +
      'notification centre stays clean.',
  })
  @ApiOkResponse({ type: TestPushResultDto })
  async testPush(@CurrentUser() actor: AuthenticatedUser): Promise<TestPushResultDto> {
    return { sent: await this.push.sendTest(actor.id) };
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
