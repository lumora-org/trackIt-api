import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceiveDeliveryItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({
    example: 44850,
    description:
      'Litres actually received. This — never the expected quantity — is what ' +
      'moves inventory. May legitimately be zero; must not be negative.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'actualQuantityLitres must be a number' })
  @Min(0, { message: 'actualQuantityLitres must not be negative' })
  actualQuantityLitres!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Minor shortage' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  discrepancyReason?: string | null;
}

export class ReceiveDeliveryDto {
  @ApiProperty({ type: [ReceiveDeliveryItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item must be supplied' })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReceiveDeliveryItemDto)
  items!: ReceiveDeliveryItemDto[];
}
