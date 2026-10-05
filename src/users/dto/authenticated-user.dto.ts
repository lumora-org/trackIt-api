import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, UserRole } from '../../common/enums/user-role.enum';

/**
 * The identity shape the frontend stores after login and expects from
 * `GET /auth/me` (PROMPT-B.E §4.1).
 */
export class AuthenticatedUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'John' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  lastName!: string;

  @ApiProperty({ example: 'manager@kbyglobal.com' })
  email!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: AccountStatus })
  status!: AccountStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  businessId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  branchId!: string | null;
}
