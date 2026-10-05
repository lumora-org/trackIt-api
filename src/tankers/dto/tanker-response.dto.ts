import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/user-role.enum';

export class TankerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'ABC-123-LA' })
  registrationNumber!: string;

  @ApiProperty({ nullable: true, example: 'TANK-001' })
  tankerCode!: string | null;

  @ApiProperty({ example: '45000.000', description: 'NUMERIC(18,3) serialised as a string' })
  capacityLitres!: string;

  @ApiProperty({ nullable: true })
  driverName!: string | null;

  @ApiProperty({ nullable: true })
  driverPhone!: string | null;

  @ApiProperty({ enum: AccountStatus })
  status!: AccountStatus;
}
