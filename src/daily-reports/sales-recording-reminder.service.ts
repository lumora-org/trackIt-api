import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';

import { BranchStatus } from '../common/enums/business.enum';
import { NotificationType } from '../common/enums/notification.enum';
import {
  endOfDayInTimeZone,
  startOfDayInTimeZone,
  toDateOnlyInTimeZone,
} from '../common/utils/date.util';
import { Branch } from '../branches/entities/branch.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Sale } from '../sales/entities/sale.entity';

/**
 * End-of-day sales-recording reminder (product decision, 2026-10).
 *
 * Under the day-total model the manager's financial obligation is to record
 * the branch's total litres sold before the day closes. When the business day
 * reaches its end without ANY sale recorded for a branch, BOTH the branch
 * managers and the business admins are alerted.
 *
 * The scheduler ticks every 30 minutes in server time and checks the wall
 * clock in the BUSINESS timezone, because `@Cron`'s `timeZone` option is
 * static while the timezone is runtime configuration. A 30-minute cadence
 * guarantees at least one tick inside the 22:00–22:29 window whatever the
 * offset between server and business time.
 */
@Injectable()
export class SalesRecordingReminderService {
  private readonly logger = new Logger(SalesRecordingReminderService.name);

  /** Guards against a double send when two ticks land in the same window. */
  private lastReminderDate: string | null = null;

  constructor(
    @InjectRepository(Branch)
    private readonly branches: Repository<Branch>,
    @InjectRepository(Sale)
    private readonly sales: Repository<Sale>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick(): Promise<void> {
    try {
      const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone: this.businessTimezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());

      const [hour, minute] = clock.split(':').map(Number);
      if (hour === 22 && minute < 30) {
        await this.remindMissingSales();
      }
    } catch (error) {
      // A clock or timezone problem must never crash the scheduler.
      this.logger.error('Sales-recording reminder tick failed', error as Error);
    }
  }

  /** Alerts managers and admins for every active branch with no sale today. */
  async remindMissingSales(): Promise<void> {
    const today = toDateOnlyInTimeZone(new Date(), this.businessTimezone);

    if (this.lastReminderDate === today) return;
    this.lastReminderDate = today;

    const dayStart = startOfDayInTimeZone(today, this.businessTimezone);
    const dayEnd = endOfDayInTimeZone(today, this.businessTimezone);

    // getRawMany, not getMany: the partial select has no primary key, so
    // TypeORM's entity transformation would return no rows and every branch
    // would be falsely reported as missing.
    const recorded = await this.sales
      .createQueryBuilder('sale')
      .select('sale.branch_id', 'branchId')
      .where('sale.sold_at >= :dayStart', { dayStart })
      .andWhere('sale.sold_at < :dayEnd', { dayEnd })
      .andWhere('sale.voided_at IS NULL')
      .distinct(true)
      .getRawMany<{ branchId: string }>();
    const recordedBranchIds = new Set(recorded.map((row) => row.branchId));

    const activeBranches = await this.branches.find({
      where: { status: BranchStatus.ACTIVE },
    });

    for (const branch of activeBranches) {
      if (recordedBranchIds.has(branch.id)) continue;

      try {
        await this.notifications.notifyBranchManagers(branch.businessId, branch.id, {
          type: NotificationType.SALES_NOT_RECORDED,
          title: 'Sales not recorded',
          message: `No sales have been recorded for ${branch.name} today (${today}). Record the day's totals before closing.`,
          resourceType: 'BRANCH',
          resourceId: branch.id,
        });

        await this.notifications.notifyBusinessAdmins(branch.businessId, {
          type: NotificationType.SALES_NOT_RECORDED,
          title: 'Sales not recorded',
          message: `${branch.name} has not recorded any sales for ${today}.`,
          resourceType: 'BRANCH',
          resourceId: branch.id,
        });

        this.logger.warn(`No sales recorded for branch ${branch.code} on ${today}`);
      } catch (error) {
        // One failing branch must not stop the remaining reminders.
        this.logger.error(
          `Failed to send the sales-recording reminder for branch ${branch.id}`,
          error as Error,
        );
      }
    }
  }
}
