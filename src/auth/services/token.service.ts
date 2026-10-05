import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../../users/entities/refresh-token.entity';
import { User } from '../../users/entities/user.entity';
import { JwtPayload } from '../../common/interfaces/authenticated-user.interface';

export interface IssuedAccessToken {
  accessToken: string;
  /** Lifetime in seconds — the frontend mirrors its client-side expiry to this. */
  expiresIn: number;
}

export interface IssuedRefreshToken {
  /** Raw value: returned to the client and never persisted. */
  refreshToken: string;
  record: RefreshToken;
}

export interface SessionMetadata {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Converts a duration string such as `15m`, `30d`, `1h` or `900` into seconds.
 */
export function durationToSeconds(value: string): number {
  const trimmed = String(value).trim();
  const match = /^(\d+)\s*([smhd])?$/i.exec(trimmed);
  if (!match) throw new Error(`Unsupported duration value: "${value}"`);

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[unit] ?? 1);
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /**
   * Short-lived access token carrying the identity and, critically, the
   * authoritative `businessId` / `branchId`. Services must read scope from this
   * payload rather than from anything the client sends (docs/06 §8).
   */
  async issueAccessToken(user: User): Promise<IssuedAccessToken> {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      businessId: user.businessId,
      branchId: user.branchId,
    };

    const expiresIn = durationToSeconds(this.config.getOrThrow<string>('jwt.accessExpiresIn'));
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, expiresIn };
  }

  /**
   * Opaque refresh token. Only its SHA-256 hash is stored, so a database dump
   * cannot be replayed against the API (docs/06 §9.1).
   */
  async issueRefreshToken(user: User, meta: SessionMetadata): Promise<IssuedRefreshToken> {
    const raw = randomBytes(48).toString('hex');
    const expiresIn = durationToSeconds(this.config.getOrThrow<string>('jwt.refreshExpiresIn'));

    const record = this.refreshTokens.create({
      userId: user.id,
      tokenHash: TokenService.hash(raw),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      revokedAt: null,
      lastUsedAt: null,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    });

    const saved = await this.refreshTokens.save(record);
    return { refreshToken: raw, record: saved };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token);
  }

  /**
   * Resolves a raw refresh token to its live session record, or null when the
   * token is unknown, already revoked, or expired.
   */
  async resolveRefreshToken(raw: string): Promise<RefreshToken | null> {
    if (!raw) return null;

    const record = await this.refreshTokens.findOne({
      where: { tokenHash: TokenService.hash(raw), revokedAt: IsNull() },
    });

    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) return null;

    return record;
  }

  /** Rotation: the presented session dies and a fresh one is issued. */
  async revokeRefreshToken(record: RefreshToken): Promise<void> {
    if (record.revokedAt) return;
    await this.refreshTokens.update(record.id, { revokedAt: new Date() });
  }

  /** Used on password change, account suspension and logout-all. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async touchRefreshToken(record: RefreshToken): Promise<void> {
    await this.refreshTokens.update(record.id, { lastUsedAt: new Date() });
  }

  /** Purges sessions that expired more than a day ago. */
  async pruneExpiredSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.refreshTokens
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('expires_at < :cutoff', { cutoff })
      .execute();

    if (result.affected) {
      this.logger.debug(`Pruned ${result.affected} expired refresh token sessions`);
    }
  }

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
