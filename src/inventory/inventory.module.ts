import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { FuelTypesModule } from '../fuel-types/fuel-types.module';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Sales and delivery receiving both post through this module, which is why it
 * must not depend on either — the documented dependency runs one way
 * (docs/05 §25).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryTransaction]),
    AuditLogsModule,
    BranchesModule,
    FuelTypesModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
