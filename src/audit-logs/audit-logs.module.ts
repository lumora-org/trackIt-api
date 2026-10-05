import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsQueryService } from './audit-logs-query.service';
import { AuditService } from './audit-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsQueryService],
  // AuditService is the write path used by every domain module; the query
  // service is deliberately not exported.
  exports: [AuditService],
})
export class AuditLogsModule {}
