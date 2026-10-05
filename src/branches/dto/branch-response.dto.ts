import { ApiProperty } from '@nestjs/swagger';
import { BranchStatus } from '../../common/enums/business.enum';

export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'KBY Ikeja' })
  name!: string;

  @ApiProperty({ example: 'KBY-IKEJA' })
  code!: string;

  @ApiProperty({ example: 'Ikeja, Lagos' })
  address!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ enum: BranchStatus })
  status!: BranchStatus;
}
