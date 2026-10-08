import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the notification raised when a fuel order is placed for a branch:
 *   FUEL_ORDER_ASSIGNED — the destination branch's manager learns that fuel
 *                         has been ordered for their branch
 *
 * Same idempotent pattern as AddNotificationTypes (PostgreSQL 12+ allows
 * `ALTER TYPE ... ADD VALUE` inside the migration transaction because the new
 * value is not used in the same transaction).
 */
export class AddFuelOrderAssignedNotificationType1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'FUEL_ORDER_ASSIGNED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values without rewriting the type and all
    // dependent columns. The value is left in place: once no code emits it, it
    // is an inert row in the type definition.
    void queryRunner;
  }
}
