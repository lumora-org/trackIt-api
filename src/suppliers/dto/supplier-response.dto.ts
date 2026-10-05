import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/user-role.enum';

export class SupplierResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'ABC Petroleum' })
  name!: string;

  @ApiProperty({ example: 'SUP-001' })
  code!: string;

  @ApiProperty({ nullable: true })
  contactPerson!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: AccountStatus })
  status!: AccountStatus;
}
