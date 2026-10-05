import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { NotificationStatus, NotificationType } from '../../common/enums/notification.enum';
import { BaseEntity, pgEnum } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

/** Notifications are always addressed to a single recipient. */
@Index('notifications_user_id_status_created_at', ['userId', 'status', 'createdAt'])
@Entity({ name: 'notifications' })
export class Notification extends BaseEntity {
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'business_id', type: 'uuid', nullable: true })
  businessId!: string | null;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: NotificationType })
  @Column({ type: pgEnum('notification_type') })
  type!: NotificationType;

  @ApiProperty({ example: 'Daily report submitted' })
  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @ApiProperty({ enum: NotificationStatus })
  @Column({ type: pgEnum('notification_status'), default: NotificationStatus.UNREAD })
  status!: NotificationStatus;

  @ApiProperty({ nullable: true })
  @Column({ name: 'resource_type', type: 'varchar', length: 50, nullable: true })
  resourceType!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
