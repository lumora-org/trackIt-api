import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Branch } from './entities/branch.entity';
import { BranchesController } from './branches.controller';
import { MyBranchesController } from './my-branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [TypeOrmModule.forFeature([Branch]), AuditLogsModule],
  controllers: [BranchesController, MyBranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
