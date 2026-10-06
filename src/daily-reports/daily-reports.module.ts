import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Branch } from '../branches/entities/branch.entity';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';
import { DailyReportReminderService } from './daily-report-reminder.service';

/**
 * Daily reports READ from the ledger and sales tables and never write to
 * them, so this module depends on Inventory but not on Deliveries or Sales
 * directly (docs/03 §93).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DailyReport, Branch]),
    AuditLogsModule,
    BranchesModule,
    InventoryModule,
    NotificationsModule,
  ],
  controllers: [DailyReportsController],
  providers: [DailyReportsService, DailyReportReminderService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
