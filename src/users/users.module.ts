import { Module, forwardRef } from '@nestjs/common';
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
 * module-level cycle; forwardRef() on both sides resolves the imports lazily
 * (the providers themselves are not circularly dependent).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, PasswordResetToken, Branch]),
    forwardRef(() => AuthModule),
    AuditLogsModule,
  ],
  controllers: [UsersController, MyProfileController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
