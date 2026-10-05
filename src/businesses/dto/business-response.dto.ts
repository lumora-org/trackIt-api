import { ApiProperty } from '@nestjs/swagger';
import { BusinessStatus } from '../../common/enums/business.enum';

export class BusinessResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'K.B.Y GLOBAL INVESTMENT' })
  name!: string;

  @ApiProperty({ nullable: true })
  registrationNumber!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: BusinessStatus })
  status!: BusinessStatus;
}
