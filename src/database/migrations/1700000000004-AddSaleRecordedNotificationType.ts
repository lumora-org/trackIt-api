import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SALE_RECORDED — fanned out to the business's admins whenever any manager
 * records a sale, so head office sees takings as they land (product decision,
 * 2026-10).
 *
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is idempotent and, on PostgreSQL
 * 12+, legal inside the migration transaction because the new value is not
 * used in the same transaction.
 */
export class AddSaleRecordedNotificationType1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SALE_RECORDED'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values without rewriting the type and all
    // dependent columns. The value is simply left in place: once no code
    // emits it it is an inert row in the type definition.
    void queryRunner;
  }
}
