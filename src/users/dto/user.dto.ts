import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountStatus, UserRole } from '../../common/enums/user-role.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyMessage,
} from '../../auth/dto/reset-password.dto';

/** Only these two roles can be created through the API. */
export const ASSIGNABLE_ROLES = [UserRole.ADMIN, UserRole.MANAGER] as const;

export class CreateUserDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'manager@kbyglobal.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: passwordPolicyMessage() })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ enum: [UserRole.ADMIN, UserRole.MANAGER] })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Required for MANAGER, must be absent for ADMIN, SUPER_ADMIN only override',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /**
   * Only meaningful for SUPER_ADMIN, who has no business of their own. An
   * ADMIN's business is derived from the token (docs/06 §31).
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'SUPER_ADMIN only' })
  @IsOptional()
  @IsUUID()
  businessId?: string;
}

/**
 * `email` and `role` are deliberately absent: they are immutable here, and
 * accepting them would be a privilege-escalation vector (docs/06 §33).
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the column' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Reassign a MANAGER to another branch' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: AccountStatus })
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/**
 * Avatar arrives as a base64 data URL. Keeping the JSON contract means zero
 * frontend changes; the column length is capped by a CHECK constraint
 * (PROMPT-B.E §6.1).
 */
export class UpdateAvatarDto {
  @ApiProperty({
    nullable: true,
    example: 'data:image/png;base64,iVBORw0KGgo...',
    description: 'A png/jpeg/webp data URL, or null to remove the avatar',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3_800_000)
  avatarUrl!: string | null;
}
