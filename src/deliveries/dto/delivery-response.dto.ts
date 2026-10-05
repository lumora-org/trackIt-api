import { ApiProperty } from '@nestjs/swagger';
import { DeliveryStatus } from '../../common/enums/fuel.enum';

export class DeliveryItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: 'PMS', nullable: true })
  fuelTypeName?: string;

  @ApiProperty({ example: '45000.000' })
  expectedQuantityLitres!: string;

  @ApiProperty({ nullable: true, example: '44850.000', description: 'null until received' })
  actualQuantityLitres!: string | null;

  @ApiProperty({ nullable: true, example: '-150.000', description: 'actual - expected' })
  differenceLitres!: string | null;

  @ApiProperty({ nullable: true })
  discrepancyReason!: string | null;
}

export class DeliveryTankerRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ABC-123-LA', nullable: true })
  registrationNumber?: string | null;

  @ApiProperty({ nullable: true })
  driverName?: string | null;
}

export class DeliveryOrderRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ORD-2026-000001' })
  orderNumber!: string;
}

export class DeliveryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'DEL-2026-000001' })
  deliveryNumber!: string | null;

  @ApiProperty({ enum: DeliveryStatus })
  status!: DeliveryStatus;

  @ApiProperty({ format: 'uuid' })
  fuelOrderId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  tankerId!: string | null;

  @ApiProperty({ format: 'uuid' })
  destinationBranchId!: string;

  @ApiProperty({ nullable: true })
  deliveredAt!: Date | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: [DeliveryItemResponseDto] })
  items!: DeliveryItemResponseDto[];

  @ApiProperty({ type: DeliveryTankerRefDto, required: false })
  tanker?: DeliveryTankerRefDto;

  @ApiProperty({ type: DeliveryOrderRefDto, required: false })
  fuelOrder?: DeliveryOrderRefDto;
}
