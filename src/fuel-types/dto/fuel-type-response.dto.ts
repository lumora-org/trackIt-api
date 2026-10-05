import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/user-role.enum';

export class FuelTypeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Premium Motor Spirit' })
  name!: string;

  @ApiProperty({ example: 'PMS' })
  code!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: AccountStatus })
  status!: AccountStatus;
}
