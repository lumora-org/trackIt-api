import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BranchesModule } from '../branches/branches.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { TankersModule } from '../tankers/tankers.module';
import { FuelTypesModule } from '../fuel-types/fuel-types.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { FuelOrder } from './entities/fuel-order.entity';
import { FuelOrderItem } from './entities/fuel-order-item.entity';
import { FuelOrdersController } from './fuel-orders.controller';
import { FuelOrdersService } from './fuel-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FuelOrder, FuelOrderItem]),
    AuditLogsModule,
    BranchesModule,
    SuppliersModule,
    TankersModule,
    FuelTypesModule,
    DeliveriesModule,
  ],
  controllers: [FuelOrdersController],
  providers: [FuelOrdersService],
  exports: [FuelOrdersService],
})
export class FuelOrdersModule {}
