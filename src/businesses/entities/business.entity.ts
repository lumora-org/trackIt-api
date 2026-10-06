import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, OneToMany } from 'typeorm';
import { BusinessStatus } from '../../common/enums/business.enum';
import { SoftDeletableEntity } from '../../common/entities/base.entity';
import { Branch } from '../../branches/entities/branch.entity';

@Entity({ name: 'businesses' })
export class Business extends SoftDeletableEntity {
  @ApiProperty({ example: 'K.B.Y GLOBAL INVESTMENT' })
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @ApiProperty({ example: 'RC123456', nullable: true })
  @Column({ name: 'registration_number', type: 'varchar', length: 100, nullable: true })
  registrationNumber!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @ApiProperty({ enum: BusinessStatus })
  @Column({ type: 'enum', enumName: 'business_status', default: BusinessStatus.ACTIVE })
  status!: BusinessStatus;

  @OneToMany(() => Branch, (branch) => branch.business)
  branches!: Branch[];
}
