import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountStatus } from '../../common/enums/user-role.enum';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../../users/users.service';

/**
 * Verifies the access token and rehydrates the caller from the database rather
 * than trusting the token body alone: a suspended or deleted account must stop
 * working immediately, not when its token happens to expire (PROMPT-B.E §2.4).
 *
 * The refresh cookie name stays configurable but defaults to the value the
 * frontend reads.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) throw new UnauthorizedException('The access token is not valid.');

    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('The access token is not valid.');

    if (user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not active.');
    }

    return this.users.toAuthenticatedUser(user);
  }
}
