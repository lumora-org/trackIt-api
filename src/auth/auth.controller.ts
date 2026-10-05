import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthenticatedUserDto } from '../users/dto/authenticated-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ApiErrorResponse } from '../common/dto/api-error-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange credentials for an access token and refresh session',
    description:
      'Sets the httpOnly `kby_refresh_token` cookie. Returns 401 ' +
      'AUTH_INVALID_CREDENTIALS with a neutral message for both an unknown ' +
      'email and a wrong password, so accounts cannot be enumerated.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string', nullable: true },
        expiresIn: { type: 'number', example: 900 },
        user: { $ref: '#/components/schemas/AuthenticatedUserDto' },
      },
    },
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(dto, req, res);
    return session;
  }

  @Public()
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh session and mint a new access token',
    description:
      'Accepts an empty body: the httpOnly cookie is the source of truth. ' +
      'A body `refreshToken` is also honoured for non-browser clients. The ' +
      'presented session is revoked and replaced on every call.',
  })
  @ApiCookieAuth()
  @ApiBody({ type: RefreshTokenDto, required: false })
  @ApiOkResponse({
    schema: {
      properties: {
        accessToken: { type: 'string' },
        expiresIn: { type: 'number', example: 900 },
      },
    },
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = this.authService.resolvePresentedRefreshToken(req, dto?.refreshToken);
    return this.authService.refresh(raw, req, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke the current refresh session and clear the cookie' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = this.authService.resolvePresentedRefreshToken(req);
    await this.authService.logout(raw, user, req);
    this.clearCookie(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every refresh session for the account' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user, req);
    this.clearCookie(res);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always responds 204 whether or not the account exists, so the endpoint ' +
      'cannot be used to discover registered email addresses.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Consume a reset token and set a new password',
    description:
      'The body field is `password`, not `newPassword`. The token is ' +
      'single-use and every existing session is revoked afterwards.',
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<void> {
    await this.authService.resetPassword(dto, req);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change the password of the signed-in account' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.changePassword(userId, dto, req);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Return the authenticated identity' })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private clearCookie(res: Response): void {
    const name = this.config.getOrThrow<string>('cookie.refreshCookieName');
    res.clearCookie(name, {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('cookie.refreshCookieSecure'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>('cookie.refreshCookieSameSite'),
      path: this.config.getOrThrow<string>('cookie.refreshCookiePath'),
    });
  }
}
