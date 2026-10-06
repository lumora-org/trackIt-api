import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AccountStatus } from '../../common/enums/user-role.enum';
import {
  QUANTITY_PRECISION,
  QUANTITY_TYPE,
  SoftDeletableEntity,
} from '../../common/entities/base.entity';
import { Business } from '../../businesses/entities/business.entity';

@Index('tankers_business_id', ['businessId'])
@Index('tankers_business_id_registration', ['businessId', 'registrationNumber'], { unique: true })
@Entity({ name: 'tankers' })
export class Tanker extends SoftDeletableEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'ABC-123-LA' })
  @Column({ name: 'registration_number', type: 'varchar', length: 50 })
  registrationNumber!: string;

  @ApiProperty({ nullable: true, example: 'TANK-001' })
  @Column({ name: 'tanker_code', type: 'varchar', length: 50, nullable: true })
  tankerCode!: string | null;

  /** NUMERIC(18,3); the DB CHECK enforces capacity_litres > 0. */
  @ApiProperty({ example: '45000.000' })
  @Column({ name: 'capacity_litres', type: QUANTITY_TYPE, ...QUANTITY_PRECISION })
  capacityLitres!: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'driver_name', type: 'varchar', length: 255, nullable: true })
  driverName!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'driver_phone', type: 'varchar', length: 30, nullable: true })
  driverPhone!: string | null;

  @ApiProperty({ enum: AccountStatus })
  @Column({ type: 'enum', enumName: 'account_status', default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;
}
