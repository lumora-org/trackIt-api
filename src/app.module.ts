import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configurations } from './config/configuration';
import { buildDataSourceOptions } from './config/typeorm.config';
import { validateEnvironment } from './config/validation';
import { CommonModule } from './common/common.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { BranchesModule } from './branches/branches.module';
import { FuelTypesModule } from './fuel-types/fuel-types.module';
import { FuelPricesModule } from './fuel-prices/fuel-prices.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TankersModule } from './tankers/tankers.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { FuelOrdersModule } from './fuel-orders/fuel-orders.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SalesModule } from './sales/sales.module';
import { DailyReportsModule } from './daily-reports/daily-reports.module';
import { DashboardsModule } from './dashboard/dashboards.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}`, '.env'],
      cache: true,
      load: configurations,
      validate: validateEnvironment,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildDataSourceOptions(config),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('throttle.ttlSeconds') * 1000,
          limit: config.getOrThrow<number>('throttle.limit'),
        },
      ],
    }),

    CommonModule,
    HealthModule,
    UsersModule,
    AuditLogsModule,
    AuthModule,
    BusinessesModule,
    BranchesModule,
    FuelTypesModule,
    FuelPricesModule,
    SuppliersModule,
    TankersModule,
    IdempotencyModule,
    DeliveriesModule,
    FuelOrdersModule,
    InventoryModule,
    NotificationsModule,
    SalesModule,
    DailyReportsModule,
    DashboardsModule,
    ReportsModule,
  ],
  providers: [
    // Order matters: the exception filter normalises everything below it.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 11 (path-to-regexp v8) requires a named wildcard; the bare '*' is
    // legacy syntax that only auto-converts with a startup warning.
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
