import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Delivery } from './entities/delivery.entity';
import { DeliveryItem } from './entities/delivery-item.entity';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryGeneratorService } from './services/delivery-number.service';

/**
 * Deliveries own their rows and post through InventoryModule; the fuel-order
 * module calls in to create the PENDING delivery rather than writing them
 * directly. That keeps the documented Fuel Orders → Deliveries → Inventory
 * dependency one-directional (docs/05 §25).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Delivery, DeliveryItem]),
    AuditLogsModule,
    InventoryModule,
    NotificationsModule,
  ],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveryGeneratorService],
  exports: [DeliveriesService, DeliveryGeneratorService],
})
export class DeliveriesModule {}
