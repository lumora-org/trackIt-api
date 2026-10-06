import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';

import { BranchStatus } from '../common/enums/business.enum';
import { NotificationType } from '../common/enums/notification.enum';
import { DailyReportStatus } from '../common/enums/report.enum';
import { Branch } from '../branches/entities/branch.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DailyReport } from './entities/daily-report.entity';

/**
 * End-of-day daily-report reminder (product decision, 2026-10).
 *
 * A manager must send the branch's total litres sold before the day closes.
 * When the business day reaches its end without a SUBMITTED/APPROVED report,
 * BOTH the branch managers and the business admins are alerted.
 *
 * The scheduler ticks every 30 minutes in server time and checks the wall
 * clock in the BUSINESS timezone, because `@Cron`'s `timeZone` option is
 * static while the timezone is runtime configuration. A 30-minute cadence
 * guarantees at least one tick inside the 22:00–22:29 window whatever the
 * offset between server and business time.
 */
@Injectable()
export class DailyReportReminderService {
  private readonly logger = new Logger(DailyReportReminderService.name);

  /** Guards against a double send when two ticks land in the same window. */
  private lastReminderDate: string | null = null;

  constructor(
    @InjectRepository(Branch)
    private readonly branches: Repository<Branch>,
    @InjectRepository(DailyReport)
    private readonly reports: Repository<DailyReport>,
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
        await this.remindMissingReports();
      }
    } catch (error) {
      // A clock or timezone problem must never crash the scheduler.
      this.logger.error('Daily-report reminder tick failed', error as Error);
    }
  }

  /** Alerts managers and admins for every active branch without a report today. */
  async remindMissingReports(): Promise<void> {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    if (this.lastReminderDate === today) return;
    this.lastReminderDate = today;

    // DRAFT and REJECTED do not count as sent: the day's totals must reach an
    // admin in a reviewable state.
    const counted = [
      DailyReportStatus.SUBMITTED,
      DailyReportStatus.UNDER_REVIEW,
      DailyReportStatus.APPROVED,
    ];

    const reported = await this.reports.find({
      where: { reportDate: today, status: In(counted) },
    });
    const reportedBranchIds = new Set(reported.map((report) => report.branchId));

    const activeBranches = await this.branches.find({
      where: { status: BranchStatus.ACTIVE },
    });

    for (const branch of activeBranches) {
      if (reportedBranchIds.has(branch.id)) continue;

      try {
        await this.notifications.notifyBranchManagers(branch.businessId, branch.id, {
          type: NotificationType.DAILY_REPORT_MISSING,
          title: 'Daily report not submitted',
          message: `Today's report for ${branch.name} (${today}) has not been submitted yet.`,
          resourceType: 'BRANCH',
          resourceId: branch.id,
        });

        await this.notifications.notifyBusinessAdmins(branch.businessId, {
          type: NotificationType.DAILY_REPORT_MISSING,
          title: 'Daily report missing',
          message: `${branch.name} has not submitted its daily report for ${today}.`,
          resourceType: 'BRANCH',
          resourceId: branch.id,
        });

        this.logger.warn(`Daily report missing for branch ${branch.code} on ${today}`);
      } catch (error) {
        // One failing branch must not stop the remaining reminders.
        this.logger.error(
          `Failed to send the daily-report reminder for branch ${branch.id}`,
          error as Error,
        );
      }
    }
  }
}
