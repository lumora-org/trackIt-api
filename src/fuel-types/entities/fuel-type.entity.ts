import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AccountStatus } from '../../common/enums/user-role.enum';
import { SoftDeletableEntity } from '../../common/entities/base.entity';
import { Business } from '../../businesses/entities/business.entity';

@Index('fuel_types_business_id', ['businessId'])
@Index('fuel_types_business_id_code', ['businessId', 'code'], { unique: true })
@Entity({ name: 'fuel_types' })
export class FuelType extends SoftDeletableEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'Premium Motor Spirit' })
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Immutable after creation; historical references depend on it (docs/08 §13). */
  @ApiProperty({ example: 'PMS' })
  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Reuses account_status; INACTIVE fuel types cannot take new sales/orders. */
  @ApiProperty({ enum: AccountStatus })
  @Column({ type: 'enum', enumName: 'account_status', default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;
}
