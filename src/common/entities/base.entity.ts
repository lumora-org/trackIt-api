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

// TypeORM validates column types against its per-driver whitelist at startup,
// so the NUMERIC modifiers must ride along via the *_PRECISION constants:
// the type string 'numeric(18,2)' fails validation, while 'numeric' spread
// with precision/scale renders the same NUMERIC(18,2) in SQL.
export const MONEY_TYPE = 'numeric' as ColumnType;
export const QUANTITY_TYPE = 'numeric' as ColumnType;

/**
 * Native PostgreSQL enum types are created by migrations (docs/03). Entity
 * columns reference them with `type: 'enum'` plus `enumName: '<type_name>'` —
 * passing the bare type name as `type` fails TypeORM's startup validation.
 */
