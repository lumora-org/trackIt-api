import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchStatus } from '../../common/enums/business.enum';
import { SoftDeletableEntity, pgEnum } from '../../common/entities/base.entity';
import { Business } from '../../businesses/entities/business.entity';
import { User } from '../../users/entities/user.entity';

/** Branch codes are unique per business, so two businesses may reuse a code. */
@Index('branches_business_id_code', ['businessId', 'code'], { unique: true })
@Index('branches_business_id', ['businessId'])
@Entity({ name: 'branches' })
export class Branch extends SoftDeletableEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ example: 'KBY Ikeja' })
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @ApiProperty({ example: 'KBY-IKEJA' })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @ApiProperty({ example: 'Ikeja, Lagos' })
  @Column({ type: 'text' })
  address!: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @ApiProperty({ enum: BranchStatus })
  @Column({ type: pgEnum('branch_status'), default: BranchStatus.ACTIVE })
  status!: BranchStatus;

  @ManyToOne(() => Business, (business) => business.branches, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @OneToMany(() => User, (user) => user.branch)
  users!: User[];
}
