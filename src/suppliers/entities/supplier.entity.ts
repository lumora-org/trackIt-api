import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AccountStatus } from '../../common/enums/user-role.enum';
import { SoftDeletableEntity } from '../../common/entities/base.entity';
import { Business } from '../../businesses/entities/business.entity';

@Index('suppliers_business_id', ['businessId'])
@Index('suppliers_business_id_code', ['businessId', 'code'], { unique: true })
@Entity({ name: 'suppliers' })
export class Supplier extends SoftDeletableEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'ABC Petroleum' })
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @ApiProperty({ example: 'SUP-001' })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'contact_person', type: 'varchar', length: 255, nullable: true })
  contactPerson!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @ApiProperty({ enum: AccountStatus })
  @Column({ type: 'enum', enumName: 'account_status', default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;
}
