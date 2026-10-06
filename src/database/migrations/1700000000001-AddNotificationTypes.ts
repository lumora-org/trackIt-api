import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expands the notification vocabulary for the broader alerting:
 *   FUEL_PRICE_UPDATE     — an admin sets a new price for a fuel type
 *   DELIVERY_IN_TRANSIT   — an order goes in transit (delivery incoming)
 *   DAILY_REPORT_MISSING  — a branch has not sent its end-of-day report
 *
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is idempotent and, on PostgreSQL
 * 12+, legal inside the migration transaction because the new values are not
 * used in the same transaction.
 */
export class AddNotificationTypes1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'FUEL_PRICE_UPDATE'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DELIVERY_IN_TRANSIT'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DAILY_REPORT_MISSING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values without rewriting the type and all
    // dependent columns. The values are simply left in place: once no code
    // emits them they are inert rows in the type definition.
    void queryRunner;
  }
}
