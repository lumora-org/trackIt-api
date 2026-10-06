import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AccountStatus, UserRole } from '../../common/enums/user-role.enum';
import { SoftDeletableEntity } from '../../common/entities/base.entity';
import { Business } from '../../businesses/entities/business.entity';
import { Branch } from '../../branches/entities/branch.entity';

@Index('users_business_id', ['businessId'])
@Index('users_branch_id', ['branchId'])
@Entity({ name: 'users' })
export class User extends SoftDeletableEntity {
  /** NULL for SUPER_ADMIN only; enforced by a CHECK constraint. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'business_id', type: 'uuid', nullable: true })
  businessId!: string | null;

  /** NULL for SUPER_ADMIN and ADMIN; required for MANAGER (docs/03 §22). */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ example: 'John' })
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName!: string;

  /** Case-insensitively unique via a functional index on LOWER(email). */
  @ApiProperty({ example: 'manager@kbyglobal.com' })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  /**
   * Data-URL avatar, capped by the migration's CHECK. Frontend-parity choice:
   * see PROMPT-B.E §6.1.
   */
  @ApiProperty({ nullable: true })
  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @ApiHideProperty()
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @ApiProperty({ enum: UserRole })
  @Column({ type: 'enum', enumName: 'user_role' })
  role!: UserRole;

  @ApiProperty({ enum: AccountStatus })
  @Column({ type: 'enum', enumName: 'account_status', default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ApiProperty({ nullable: true })
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'business_id' })
  business!: Business | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch | null;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
