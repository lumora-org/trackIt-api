import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { MONEY_PRECISION, MONEY_TYPE, BaseEntity } from '../../common/entities/base.entity';
import { FuelType } from '../../fuel-types/entities/fuel-type.entity';
import { Business } from '../../businesses/entities/business.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A fuel price is a half-open time interval `[effective_from, effective_to)` —
 * start inclusive, end exclusive (docs/08 §17). `effective_to IS NULL` means
 * the interval is still open, and there must be at most one open interval per
 * business + fuel type.
 *
 * Overlap is prevented by a PostgreSQL EXCLUDE USING gist constraint created in
 * the initial migration; historical rows are never updated or deleted, only
 * closed (docs/08 §23, §29).
 */
@Index('fuel_prices_business_id_fuel_type_id', ['businessId', 'fuelTypeId'])
@Index('fuel_prices_effective_from', ['effectiveFrom'])
@Entity({ name: 'fuel_prices' })
export class FuelPrice extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'fuel_type_id', type: 'uuid' })
  fuelTypeId!: string;

  @ApiProperty({ example: '1500.00', description: 'NUMERIC(18,2) serialised as a string' })
  @Column({ name: 'price_per_litre', type: MONEY_TYPE, ...MONEY_PRECISION })
  pricePerLitre!: string;

  @ApiProperty()
  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true, description: 'null means the interval is still open' })
  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @ManyToOne(() => FuelType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fuel_type_id' })
  fuelType!: FuelType;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator!: User | null;

  /** True when this interval contains `at` under half-open semantics. */
  appliesAt(at: Date): boolean {
    const from = this.effectiveFrom.getTime();
    const to = this.effectiveTo ? this.effectiveTo.getTime() : Number.POSITIVE_INFINITY;
    const target = at.getTime();
    return target >= from && target < to;
  }
}
