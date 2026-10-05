import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SignOptions } from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../users/entities/refresh-token.entity';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Auth depends on Users, never the reverse — hashing and token issuance live
 * here so `UsersService` stays free of auth concerns (docs/05 §25).
 */
@Module({
  imports: [
    UsersModule,
    AuditLogsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Access and refresh use *different* secrets (docs/06 §48). The startup
        // validator rejects a configuration where they are identical.
        secret: config.getOrThrow<string>('jwt.accessSecret'),
        signOptions: {
          // jsonwebtoken types this as `number | StringValue`; the value is
          // validated at startup by config/validation.ts.
          expiresIn: config.getOrThrow<string>('jwt.accessExpiresIn') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy],
  exports: [PasswordService, TokenService, AuthService],
})
export class AuthModule {}
