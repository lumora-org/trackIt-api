import { ApiProperty } from '@nestjs/swagger';

export class FuelPriceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '1500.00', description: 'NUMERIC(18,2) serialised as a string' })
  pricePerLitre!: string;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true, description: 'null means the interval is still open' })
  effectiveTo!: Date | null;
}

export class CurrentFuelPriceDto {
  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '1500.00' })
  pricePerLitre!: string;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true })
  effectiveTo!: Date | null;
}
