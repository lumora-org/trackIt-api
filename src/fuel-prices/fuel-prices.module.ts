import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FuelTypesModule } from '../fuel-types/fuel-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FuelPrice } from './entities/fuel-price.entity';
import { FuelPricesController } from './fuel-prices.controller';
import { FuelPricesService } from './fuel-prices.service';

/**
 * Sales depends on this module to resolve prices; nothing here depends on
 * Sales, keeping the dependency one-directional (docs/05 §25).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FuelPrice]),
    FuelTypesModule,
    AuditLogsModule,
    NotificationsModule,
  ],
  controllers: [FuelPricesController],
  providers: [FuelPricesService],
  exports: [FuelPricesService],
})
export class FuelPricesModule {}
