import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FuelOrderStatus } from '../../common/enums/fuel.enum';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateFuelOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fuelTypeId!: string;

  @ApiProperty({ example: 45000, description: 'Expected litres, must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'expectedQuantityLitres must be a number' })
  @IsPositive({ message: 'expectedQuantityLitres must be greater than 0' })
  expectedQuantityLitres!: number;

  @ApiProperty({
    example: 1200,
    description:
      'Procurement cost per litre in naira — never the retail selling price, ' +
      'which is controlled by the fuel pricing module',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitCost must be a number' })
  @IsPositive({ message: 'unitCost must be greater than 0' })
  unitCost!: number;
}

/**
 * An order is a procurement commitment and never stock. There is deliberately no
 * `businessId` and no `status` in this body: the business comes from the token
 * and a new order is always DRAFT (PROMPT-B.E §4.9).
 */
export class CreateFuelOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationBranchId!: string;

  @ApiProperty({ example: '2026-10-06T10:00:00.000Z' })
  @IsDateString({}, { message: 'expectedDeliveryAt must be an ISO 8601 timestamp' })
  expectedDeliveryAt!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Tanker assigned to the delivery, if already known. Optional: dispatch ' +
      'can attach or change it when the order goes IN_TRANSIT.',
  })
  @IsOptional()
  @IsUUID()
  tankerId?: string;

  @ApiPropertyOptional({ nullable: true, example: 'Morning delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty({ type: [CreateFuelOrderItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1, { message: 'an order must contain at least one item' })
  @ArrayMaxSize(20, { message: 'an order may contain at most 20 items' })
  @ValidateNested({ each: true })
  @Type(() => CreateFuelOrderItemDto)
  items!: CreateFuelOrderItemDto[];
}

export class CancelFuelOrderDto {
  @ApiProperty({ example: 'Supplier could not fulfil the order.' })
  @IsString()
  @MinLength(1, { message: 'a cancellation reason is required' })
  @MaxLength(2000)
  reason!: string;
}

export class ListFuelOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FuelOrderStatus })
  @IsOptional()
  @IsEnum(FuelOrderStatus)
  status?: FuelOrderStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Destination branch filter' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
