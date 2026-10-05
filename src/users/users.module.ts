import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Global because nearly every module needs to resolve the current actor and
 * check business/branch scope. Exposing only UsersService keeps repositories
 * private (docs/05 §25).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken, PasswordResetToken])],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
