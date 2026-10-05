import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, UserRole } from '../../common/enums/user-role.enum';

/** User list/create payload: the authenticated identity plus lastLoginAt. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
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

  @ApiProperty({ nullable: true })
  lastLoginAt!: Date | null;
}
