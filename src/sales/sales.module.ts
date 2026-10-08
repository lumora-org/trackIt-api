import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { FuelTypesModule } from '../fuel-types/fuel-types.module';
import { FuelPricesModule } from '../fuel-prices/fuel-prices.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Sale } from './entities/sale.entity';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/**
 * Sales depends on FuelPrices and Inventory; neither depends on Sales, so the
 * price a litre cost is resolved in exactly one place (docs/05 §25, §58).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Sale]),
    AuditLogsModule,
    BranchesModule,
    FuelTypesModule,
    FuelPricesModule,
    InventoryModule,
    NotificationsModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
