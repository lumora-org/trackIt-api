import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Branch } from '../branches/entities/branch.entity';
import { Sale } from '../sales/entities/sale.entity';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';
import { SalesRecordingReminderService } from './sales-recording-reminder.service';

/**
 * Daily reports READ from the ledger and sales tables and never write to
 * them, so this module depends on Inventory but not on Deliveries or Sales
 * directly (docs/03 §93). The sales roll-up and the end-of-day reminder read
 * the sales table directly through the data source, which is why `Sale` is
 * registered here even though sales itself lives in its own module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DailyReport, Branch, Sale]),
    AuditLogsModule,
    BranchesModule,
    InventoryModule,
    NotificationsModule,
  ],
  controllers: [DailyReportsController],
  providers: [DailyReportsService, SalesRecordingReminderService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
