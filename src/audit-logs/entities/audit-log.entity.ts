import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Append-only audit trail (docs/03 §60, §62).
 *
 * No endpoint may update or delete these rows; the migration additionally
 * REVOKEs UPDATE/DELETE from the application role as a second line of defence.
 * `action` is a free VARCHAR, not an enum: docs/03 §10 lists an `audit_action`
 * type but never defines it.
 */
@Index('audit_logs_business_id_user_id', ['businessId', 'userId'])
@Index('audit_logs_resource_type_resource_id', ['resourceType', 'resourceId'])
@Index('audit_logs_created_at', ['createdAt'])
@Index('audit_logs_action', ['action'])
@Entity({ name: 'audit_logs' })
export class AuditLog extends BaseEntity {
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'business_id', type: 'uuid', nullable: true })
  businessId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ example: 'SALE_CREATED' })
  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @ApiProperty({ nullable: true, example: 'SALE' })
  @Column({ name: 'resource_type', type: 'varchar', length: 100, nullable: true })
  resourceType!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;
}
