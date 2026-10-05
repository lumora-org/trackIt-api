import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../branches/entities/branch.entity';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { MyProfileController, UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Global because nearly every module needs to resolve the current actor and
 * check business/branch scope. Only UsersService is exported, keeping
 * repositories private (docs/05 §25).
 *
 * AuthModule is imported for PasswordService and TokenService, which the
 * admin write paths need. AuthModule in turn imports UsersModule, so this is a
 * module-level cycle; it resolves at runtime because neither provider reads
 * the other during construction.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, PasswordResetToken, Branch]),
    AuthModule,
    AuditLogsModule,
  ],
  controllers: [UsersController, MyProfileController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
