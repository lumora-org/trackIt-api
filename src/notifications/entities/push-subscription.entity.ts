import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One row per browser/device a user has opted in to push alerts on.
 *
 * `endpoint` is unique because the push service hands out exactly one URL per
 * subscription: the same device re-registering after a reload must update the
 * existing row instead of accumulating duplicates that would each receive the
 * same alert. `p256dh` and `auth` are the subscriber's payload-encryption keys —
 * secrets of the recipient, so they are never returned by any endpoint.
 */
@Index('push_subscriptions_user_id', ['userId'])
@Index('push_subscriptions_endpoint', ['endpoint'], { unique: true })
@Entity({ name: 'push_subscriptions' })
export class PushSubscription extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'endpoint', type: 'varchar', length: 2048 })
  endpoint!: string;

  @Column({ name: 'p256dh', type: 'varchar', length: 255 })
  p256dh!: string;

  @Column({ name: 'auth', type: 'varchar', length: 255 })
  auth!: string;

  /** Which browser the device reported — only ever used for support triage. */
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
