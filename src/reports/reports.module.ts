import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ExportAuthGuard } from '../auth/guards/export-auth.guard';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  // UsersModule is global, but AuthModule is imported explicitly for TokenService
  // so the export cookie-auth guard has its dependency declared where it is used.
  imports: [AuthModule, UsersModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExportAuthGuard],
  exports: [ReportsService],
})
export class ReportsModule {}
