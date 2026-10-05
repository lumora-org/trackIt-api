import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AccountStatus } from '../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TokenService } from '../services/token.service';
import { UsersService } from '../../users/users.service';

/**
 * Authenticates a browser-initiated file download.
 *
 * The frontend builds a plain URL and lets the browser navigate to it
 * (PROMPT-B.E §6.2). A navigation cannot attach the in-memory Authorization
 * header, so this guard accepts EITHER a normal bearer token OR a valid
 * httpOnly refresh cookie, and populates request.user either way.
 *
 * It deliberately does NOT relax anything else: the role guard and every scope
 * clamp inside the report queries still apply, so the cookie proves identity
 * rather than granting blanket access. The refresh cookie is only honoured on
 * routes that opt in with @UseGuards(ExportAuthGuard).
 */
@Injectable()
export class ExportAuthGuard {
  constructor(
    private readonly tokenService: TokenService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const hasBearer = Boolean(request.headers.authorization);

    if (hasBearer) {
      // A real access token is present: it will be verified by JwtAuthGuard,
      // which runs globally ahead of this route guard.
      return true;
    }

    const cookieName = this.config.getOrThrow<string>('cookie.refreshCookieName');
    const raw = (request.cookies as Record<string, string> | undefined)?.[cookieName];

    if (!raw) {
      throw new UnauthorizedException('An authenticated session is required to download a report.');
    }

    const session = await this.tokenService.resolveRefreshToken(raw);
    if (!session) {
      throw new UnauthorizedException('The export session is no longer valid.');
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('The export session is no longer valid.');
    }

    request.user = this.users.toAuthenticatedUser(user);
    return true;
  }
}
