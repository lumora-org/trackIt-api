import { randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AccountStatus } from '../common/enums/user-role.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { apiError, validationError } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { extractSessionMetadata } from '../common/utils/request.util';
import { durationToSeconds, TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from '../users/users.service';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 12-step login from docs/06 §11.
   *
   * Failure responses are deliberately identical whether the email is unknown
   * or the password is wrong, and the unknown-email path still burns a hash
   * verification so response timing cannot enumerate accounts (docs/06 §40).
   */
  async login(dto: LoginDto, req: Request, res: Response): Promise<AuthSession> {
    const session = extractSessionMetadata(req);
    const user = await this.users.findByEmail(dto.email);

    if (!user) {
      await this.passwordService.fakeVerify();
      await this.audit.record(
        { ipAddress: session.ipAddress, userAgent: session.userAgent },
        {
          action: AuditAction.LOGIN_FAILED,
          resourceType: AuditResourceType.AUTH,
          metadata: { email: dto.email.toLowerCase(), reason: 'unknown_account' },
        },
      );
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await this.passwordService.verify(user.passwordHash, dto.password);

    if (!passwordMatches) {
      await this.audit.record(
        { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
        {
          action: AuditAction.LOGIN_FAILED,
          resourceType: AuditResourceType.AUTH,
          metadata: { email: user.email, reason: 'bad_password' },
        },
      );
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Suspended and inactive accounts get a distinct, non-enumerating message.
    if (user.status !== AccountStatus.ACTIVE) {
      throw apiError(
        ErrorCode.AUTH_ACCOUNT_INACTIVE,
        'This account is not active. Please contact an administrator.',
      );
    }

    const { accessToken, expiresIn } = await this.tokenService.issueAccessToken(user);
    const issued = await this.tokenService.issueRefreshToken(user, session);

    await this.users.recordLogin(user.id);

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      {
        action: AuditAction.LOGIN_SUCCESS,
        resourceType: AuditResourceType.AUTH,
        resourceId: user.id,
      },
    );

    this.setRefreshCookie(res, issued.refreshToken);

    return {
      accessToken,
      refreshToken: issued.refreshToken,
      expiresIn,
      user: this.users.toAuthenticatedUser(user),
    };
  }

  /**
   * Rotates the presented session. The frontend drives this with an empty body
   * plus the httpOnly cookie and the `X-Requested-Refresh` header
   * (PROMPT-B.E §2.4); a body token is accepted for non-browser clients.
   */
  async refresh(
    rawToken: string | undefined,
    req: Request,
    res: Response,
  ): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const session = extractSessionMetadata(req);

    if (!rawToken) {
      throw apiError(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'The refresh token is not valid.');
    }

    const record = await this.tokenService.resolveRefreshToken(rawToken);
    if (!record) {
      throw apiError(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'The refresh token is not valid.');
    }

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw apiError(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'The refresh token is not valid.');
    }

    if (user.status !== AccountStatus.ACTIVE) {
      // A suspended account must not be able to resurrect a session.
      await this.tokenService.revokeRefreshToken(record);
      throw apiError(ErrorCode.AUTH_ACCOUNT_INACTIVE, 'This account is not active.');
    }

    // Rotation: the old session dies before the new one is issued.
    await this.tokenService.revokeRefreshToken(record);
    const replacement = await this.tokenService.issueRefreshToken(user, session);
    const { accessToken, expiresIn } = await this.tokenService.issueAccessToken(user);

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      {
        action: AuditAction.TOKEN_REFRESH,
        resourceType: AuditResourceType.AUTH,
        resourceId: user.id,
      },
    );

    this.setRefreshCookie(res, replacement.refreshToken);

    return { accessToken, expiresIn };
  }

  /** Revokes the presented session only. */
  async logout(rawToken: string | undefined, user: AuthenticatedUser, req: Request): Promise<void> {
    const session = extractSessionMetadata(req);

    if (rawToken) {
      const record = await this.tokenService.resolveRefreshToken(rawToken);
      if (record && record.userId === user.id) {
        await this.tokenService.revokeRefreshToken(record);
      }
    }

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      { action: AuditAction.LOGOUT, resourceType: AuditResourceType.AUTH, resourceId: user.id },
    );
  }

  /** Revokes every session for the account — "sign out everywhere". */
  async logoutAll(user: AuthenticatedUser, req: Request): Promise<void> {
    const session = extractSessionMetadata(req);
    await this.tokenService.revokeAllForUser(user.id);

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      {
        action: AuditAction.LOGOUT_ALL,
        resourceType: AuditResourceType.AUTH,
        resourceId: user.id,
      },
    );
  }

  /**
   * Always responds neutrally so the endpoint cannot be used to discover which
   * email addresses have accounts (docs/06 §40).
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== AccountStatus.ACTIVE) return;

    const rawToken = randomBytes(32).toString('hex');
    const ttlSeconds = durationToSeconds(
      this.config.getOrThrow<string>('jwt.passwordResetExpiresIn'),
    );

    await this.users.createPasswordResetToken(
      user.id,
      TokenService.hash(rawToken),
      new Date(Date.now() + ttlSeconds * 1000),
    );

    // Delivery is a deployment concern (SMTP is not configured in the MVP);
    // the token is logged at debug level rather than emailed or returned, so it
    // never reaches the client.
    this.logger.debug(`Password reset token issued for ${user.email}`, { token: rawToken });
  }

  async resetPassword(dto: ResetPasswordDto, req: Request): Promise<void> {
    const session = extractSessionMetadata(req);
    const user = await this.users.consumePasswordResetToken(TokenService.hash(dto.token));

    if (!user) {
      throw apiError(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        'This password reset link is invalid or has expired.',
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    await this.users.setPasswordHash(user.id, passwordHash);

    // A password reset invalidates every existing session (docs/06 §15).
    await this.tokenService.revokeAllForUser(user.id);

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      {
        action: AuditAction.PASSWORD_RESET,
        resourceType: AuditResourceType.AUTH,
        resourceId: user.id,
      },
    );
  }

  async changePassword(userId: string, dto: ChangePasswordDto, req: Request): Promise<void> {
    const session = extractSessionMetadata(req);
    const user = await this.users.findById(userId);

    if (!user) {
      throw apiError(ErrorCode.AUTH_TOKEN_EXPIRED, 'Authentication is required.');
    }

    const currentMatches = await this.passwordService.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!currentMatches) {
      throw validationError('The current password is incorrect.', [
        { field: 'currentPassword', message: 'The current password is incorrect.' },
      ]);
    }

    if (dto.newPassword === dto.currentPassword) {
      throw validationError('The new password must differ from the current password.', [
        {
          field: 'newPassword',
          message: 'The new password must differ from the current password.',
        },
      ]);
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.users.setPasswordHash(user.id, passwordHash);
    await this.tokenService.revokeAllForUser(user.id);

    await this.audit.record(
      { userId: user.id, businessId: user.businessId, branchId: user.branchId, ...session },
      {
        action: AuditAction.PASSWORD_RESET,
        resourceType: AuditResourceType.AUTH,
        resourceId: user.id,
        metadata: { method: 'change_password' },
      },
    );
  }

  async getProfile(userId: string): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw apiError(ErrorCode.AUTH_TOKEN_EXPIRED, 'Authentication is required.');
    }
    return this.users.toAuthenticatedUser(user);
  }

  // ── Cookie handling ───────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, rawToken: string): void {
    const name = this.config.getOrThrow<string>('cookie.refreshCookieName');
    const secure = this.config.getOrThrow<boolean>('cookie.refreshCookieSecure');
    const sameSite = this.config.getOrThrow<'lax' | 'strict' | 'none'>(
      'cookie.refreshCookieSameSite',
    );
    const maxAge = durationToSeconds(this.config.getOrThrow<string>('jwt.refreshExpiresIn')) * 1000;

    res.cookie(name, rawToken, {
      httpOnly: true,
      secure,
      sameSite,
      path: this.config.getOrThrow<string>('cookie.refreshCookiePath'),
      maxAge,
    });
  }

  clearRefreshCookie(res: Response): void {
    const name = this.config.getOrThrow<string>('cookie.refreshCookieName');
    res.clearCookie(name, {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('cookie.refreshCookieSecure'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>('cookie.refreshCookieSameSite'),
      path: this.config.getOrThrow<string>('cookie.refreshCookiePath'),
    });
  }

  /** Reads the refresh token from the cookie, falling back to the body. */
  resolvePresentedRefreshToken(req: Request, bodyToken?: string): string | undefined {
    const cookieName = this.config.getOrThrow<string>('cookie.refreshCookieName');
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[cookieName];
    return fromCookie ?? bodyToken;
  }
}
