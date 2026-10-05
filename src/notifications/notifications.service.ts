import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NotificationStatus, NotificationType } from '../common/enums/notification.enum';
import { AccountStatus, UserRole } from '../common/enums/user-role.enum';
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

  /** Fans a notification out to every active ADMIN of a business. */
  async notifyBusinessAdmins(
    businessId: string,
    request: NotificationRequest,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager ? manager.getRepository(Notification) : this.repository;

    const recipients = await repository.manager
      .createQueryBuilder()
      .select('user.id', 'id')
      .from('users', 'user')
      .where('user.business_id = :businessId', { businessId })
      .andWhere('user.role = :role', { role: UserRole.ADMIN })
      .andWhere('user.status = :status', { status: AccountStatus.ACTIVE })
      .andWhere('user.deleted_at IS NULL')
      .getRawMany<{ id: string }>();

    if (recipients.length === 0) return 0;

    await repository.save(
      recipients.map((recipient) =>
        repository.create({
          userId: recipient.id,
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
}
