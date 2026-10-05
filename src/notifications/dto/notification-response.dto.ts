import { ApiProperty } from '@nestjs/swagger';
import { NotificationStatus, NotificationType } from '../../common/enums/notification.enum';

export class AppNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ example: 'Daily report submitted' })
  title!: string;

  @ApiProperty({ nullable: true })
  message!: string | null;

  @ApiProperty({ enum: NotificationStatus })
  status!: NotificationStatus;

  @ApiProperty({ nullable: true })
  resourceType!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  resourceId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  readAt!: Date | null;
}

/** Response of PATCH /notifications/read-all. The client ignores the body. */
export class ReadAllResultDto {
  @ApiProperty({ example: 7 })
  updated!: number;
}
