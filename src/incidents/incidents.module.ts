import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentReport } from './entities/incident-report.entity';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/**
 * Branch incident reports (product decision, 2026-10). This module never
 * touches inventory or sales: incidents explain the numbers, they do not
 * produce them.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentReport]),
    AuditLogsModule,
    BranchesModule,
    NotificationsModule,
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
