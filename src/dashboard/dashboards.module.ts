import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/**
 * Pure read-only aggregation: depends on Inventory, depends on nothing that
 * writes. The exported movementTotals is reused by the reports module so both
 * surfaces agree on window semantics.
 */
@Module({
  imports: [InventoryModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
