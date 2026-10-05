import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FuelType } from './entities/fuel-type.entity';
import { FuelTypesController } from './fuel-types.controller';
import { FuelTypesService } from './fuel-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([FuelType]), AuditLogsModule],
  controllers: [FuelTypesController],
  providers: [FuelTypesService],
  exports: [FuelTypesService],
})
export class FuelTypesModule {}
