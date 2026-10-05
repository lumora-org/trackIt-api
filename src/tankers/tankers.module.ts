import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Tanker } from './entities/tanker.entity';
import { TankersController } from './tankers.controller';
import { TankersService } from './tankers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tanker]), AuditLogsModule],
  controllers: [TankersController],
  providers: [TankersService],
  exports: [TankersService],
})
export class TankersModule {}
