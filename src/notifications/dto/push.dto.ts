import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Web Push subscription payloads (docs/04 §72 family, PWA alerts).
 *
 * The subscription's encryption keys are write-only: no response DTO ever
 * carries `endpoint`, `p256dh` or `auth`, so a leaked response can never be
 * used to impersonate the device or read its messages.
 */
export class PushKeysDto {
  @ApiProperty({ description: 'ECMA-262 p256dh public key, base64url encoded' })
  @IsString()
  @MaxLength(255)
  p256dh!: string;

  @ApiProperty({ description: 'Shared secret the push service uses to authenticate' })
  @IsString()
  @MaxLength(255)
  auth!: string;
}

export class RegisterPushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/…' })
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  /** Optional hint stored for support triage; the request header wins when present. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  userAgent?: string;
}

export class PushSubscriptionSummaryDto {
  @ApiProperty({ format: 'uuid', description: 'Use this id to unsubscribe this device' })
  id!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class PushStatusDto {
  @ApiProperty({
    description: 'False when the server has no VAPID key pair; the client then hides the toggle',
  })
  enabled!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'applicationServerKey for PushManager.subscribe(), null when disabled',
  })
  applicationServerKey!: string | null;

  @ApiProperty({ type: [PushSubscriptionSummaryDto] })
  subscriptions!: PushSubscriptionSummaryDto[];
}

/** Response of POST /notifications/push/subscriptions. */
export class RegisteredPushSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'False when this device was already registered' })
  created!: boolean;
}

/** Response of POST /notifications/push/test. */
export class TestPushResultDto {
  @ApiProperty({
    example: 2,
    description: 'Devices the test alert was handed to the push service for',
  })
  sent!: number;
}
