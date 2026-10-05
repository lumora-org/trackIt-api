import { ApiProperty } from '@nestjs/swagger';
import { FuelOrderStatus } from '../../common/enums/fuel.enum';

export class ReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ABC Petroleum' })
  name!: string;
}

export class FuelOrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS' })
  fuelTypeName!: string;

  @ApiProperty({ example: '45000.000' })
  expectedQuantityLitres!: string;

  @ApiProperty({
    example: '1200.00',
    description: 'Procurement cost per litre, never the retail price',
  })
  unitCost!: string;
}

export class FuelOrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ORD-2026-000001' })
  orderNumber!: string;

  @ApiProperty({ enum: FuelOrderStatus })
  status!: FuelOrderStatus;

  @ApiProperty({ type: ReferenceDto })
  supplier!: ReferenceDto;

  @ApiProperty({ type: ReferenceDto })
  destinationBranch!: ReferenceDto;

  @ApiProperty({ nullable: true })
  expectedDeliveryAt!: Date | null;

  @ApiProperty({ nullable: true })
  orderedAt!: Date | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: [FuelOrderItemResponseDto] })
  items!: FuelOrderItemResponseDto[];
}
