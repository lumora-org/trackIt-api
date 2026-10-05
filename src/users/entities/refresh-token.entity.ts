import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from './user.entity';

/**
 * One row per refresh-token session. Only a SHA-256 hash of the token is
 * stored — a raw refresh token must never reach the database
 * (docs/06 §9.1, PROMPT.md §12).
 */
@Index('refresh_tokens_user_id', ['userId'])
@Index('refresh_tokens_token_hash', ['tokenHash'], { unique: true })
@Index('refresh_tokens_expires_at', ['expiresAt'])
@Entity({ name: 'refresh_tokens' })
export class RefreshToken extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Rotation and logout set this; a non-null value means the session is dead. */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
