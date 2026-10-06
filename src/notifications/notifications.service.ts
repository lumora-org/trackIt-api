import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NotificationStatus, NotificationType } from '../common/enums/notification.enum';
import { AccountStatus, UserRole } from '../common/enums/user-role.enum';
import { notFound } from '../common/errors/api-exception';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { AppNotificationDto } from './dto/notification-response.dto';
import { Notification } from './entities/notification.entity';

export interface NotificationRequest {
  type: NotificationType;
  title: string;
  message?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  /**
   * Raises a notification for one recipient.
   *
   * Pass the transaction `manager` so the notification commits atomically with
   * the business event that caused it — a report submission and its
   * notification must not be able to disagree (PROMPT-B.E §4.14).
   */
  async notifyUser(
    userId: string,
    request: NotificationRequest,
    options: { businessId?: string | null; manager?: EntityManager } = {},
  ): Promise<Notification | null> {
    const repository = options.manager
      ? options.manager.getRepository(Notification)
      : this.repository;

    return repository.save(
      repository.create({
        userId,
        businessId: options.businessId ?? null,
        type: request.type,
        title: request.title,
        message: request.message ?? null,
        status: NotificationStatus.UNREAD,
        resourceType: request.resourceType ?? null,
        resourceId: request.resourceId ?? null,
        readAt: null,
      }),
    );
  }

  /**
   * Shared row-fan-out used by the role helpers: saves one notification per
   * recipient id without re-querying.
   */
  private async saveMany(
    repository: Repository<Notification>,
    businessId: string | null,
    recipientIds: string[],
    request: NotificationRequest,
  ): Promise<void> {
    await repository.save(
      recipientIds.map((userId) =>
        repository.create({
          userId,
          businessId,
          type: request.type,
          title: request.title,
          message: request.message ?? null,
          status: NotificationStatus.UNREAD,
          resourceType: request.resourceType ?? null,
          resourceId: request.resourceId ?? null,
          readAt: null,
        }),
      ),
    );
  }

  /** Fans a notification out to every active ADMIN of a business. */
  async notifyBusinessAdmins(
    businessId: string,
    request: NotificationRequest,
    manager?: EntityManager,
  ): Promise<number> {
    return this.notifyBusinessRole(businessId, UserRole.ADMIN, request, manager);
  }

  /** Fans a notification out to every active MANAGER of a business. */
  async notifyBusinessManagers(
    businessId: string,
    request: NotificationRequest,
    manager?: EntityManager,
  ): Promise<number> {
    return this.notifyBusinessRole(businessId, UserRole.MANAGER, request, manager);
  }

  /**
   * Fans a notification out to the active MANAGERs of one branch — used for
   * delivery and daily-report alerts, which are branch-scoped events.
   */
  async notifyBranchManagers(
    businessId: string,
    branchId: string,
    request: NotificationRequest,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager ? manager.getRepository(Notification) : this.repository;

    const recipients = await repository.manager
      .createQueryBuilder()
      .select('user.id', 'id')
      .from('users', 'user')
      .where('user.business_id = :businessId', { businessId })
      .andWhere('user.branch_id = :branchId', { branchId })
      .andWhere('user.role = :role', { role: UserRole.MANAGER })
      .andWhere('user.status = :status', { status: AccountStatus.ACTIVE })
      .andWhere('user.deleted_at IS NULL')
      .getRawMany<{ id: string }>();

    if (recipients.length === 0) return 0;

    await this.saveMany(
      repository,
      businessId,
      recipients.map((r) => r.id),
      request,
    );
    return recipients.length;
  }

  private async notifyBusinessRole(
    businessId: string,
    role: UserRole,
    request: NotificationRequest,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager ? manager.getRepository(Notification) : this.repository;

    const recipients = await repository.manager
      .createQueryBuilder()
      .select('user.id', 'id')
      .from('users', 'user')
      .where('user.business_id = :businessId', { businessId })
      .andWhere('user.role = :role', { role })
      .andWhere('user.status = :status', { status: AccountStatus.ACTIVE })
      .andWhere('user.deleted_at IS NULL')
      .getRawMany<{ id: string }>();

    if (recipients.length === 0) return 0;

    await this.saveMany(
      repository,
      businessId,
      recipients.map((r) => r.id),
      request,
    );
    return recipients.length;
  }

  async notifyUsers(
    userIds: string[],
    request: NotificationRequest,
    options: { businessId?: string | null; manager?: EntityManager } = {},
  ): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;

    const repository = options.manager
      ? options.manager.getRepository(Notification)
      : this.repository;

    await repository.save(
      unique.map((userId) =>
        repository.create({
          userId,
          businessId: options.businessId ?? null,
          type: request.type,
          title: request.title,
          message: request.message ?? null,
          status: NotificationStatus.UNREAD,
          resourceType: request.resourceType ?? null,
          resourceId: request.resourceId ?? null,
          readAt: null,
        }),
      ),
    );
  }

  /**
   * Filters a list of candidate ids down to those belonging to ACTIVE,
   * non-deleted accounts — used when notifying a report's author, who may have
   * been suspended since submitting.
   */
  async filterActiveUsers(userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return [];

    const rows = await this.repository.manager
      .createQueryBuilder()
      .select('user.id', 'id')
      .from('users', 'user')
      .where('user.id IN (:...ids)', { ids: unique })
      .andWhere('user.status = :status', { status: AccountStatus.ACTIVE })
      .andWhere('user.deleted_at IS NULL')
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /**
   * The caller's own notifications. A recipient may only ever read their own
   * (docs/04 §72): the filter is built from the authenticated id, never from a
   * query parameter, so there is nothing to tamper with.
   */
  async findForRecipient(
    query: ListNotificationsQueryDto,
    userId: string,
  ): Promise<PaginatedResult<AppNotificationDto>> {
    const builder = this.repository
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId })
      .orderBy('notification.created_at', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (query.status) {
      builder.andWhere('notification.status = :status', { status: query.status });
    }
    if (query.type) {
      builder.andWhere('notification.type = :type', { type: query.type });
    }

    const [items, total] = await builder.getManyAndCount();

    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  /** Marks one notification read. A foreign id is indistinguishable from absent. */
  async markRead(id: string, userId: string): Promise<AppNotificationDto> {
    const notification = await this.repository.findOne({ where: { id, userId } });

    // Scoped by recipient in the query, so another user's id simply does not
    // resolve rather than leaking that the row exists.
    if (!notification) {
      throw notFound('The requested notification was not found.');
    }

    if (notification.status === NotificationStatus.UNREAD) {
      notification.status = NotificationStatus.READ;
      notification.readAt = new Date();
      await this.repository.save(notification);
    }

    return this.toResponse(notification);
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Notification)
      .set({ status: NotificationStatus.READ, readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('status = :status', { status: NotificationStatus.UNREAD })
      .execute();

    return result.affected ?? 0;
  }

  toResponse(notification: Notification): AppNotificationDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      status: notification.status,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    };
  }
}
