import { ApiProperty } from '@nestjs/swagger';
import {
  ColumnType,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Shared column definitions.
 *
 * Monetary values are NUMERIC(18,2) and fuel volumes NUMERIC(18,3) (docs/03
 * §8, §9). Both are exposed as `string` because TypeORM returns NUMERIC as a
 * string and floats cannot represent 44850.125 exactly (docs/05 §27) — always
 * go through `DecimalMath` for arithmetic.
 */
export abstract class BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** Master/reference data is soft deleted so history stays intact (docs/03 §68). */
export abstract class SoftDeletableEntity extends BaseEntity {
  @ApiProperty({ nullable: true })
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

export const MONEY_PRECISION = { precision: 18, scale: 2 } as const;
export const QUANTITY_PRECISION = { precision: 18, scale: 3 } as const;

export const MONEY_TYPE = 'numeric(18,2)' as ColumnType;
export const QUANTITY_TYPE = 'numeric(18,3)' as ColumnType;

/**
 * PostgreSQL enum types created by the migration are valid at runtime but are
 * not part of TypeORM's built-in `ColumnType` union, so they are declared here
 * once rather than cast at every call site.
 */
export const pgEnum = (typeName: string): ColumnType => typeName as ColumnType;
