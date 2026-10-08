import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The admin confirmation gate on recorded sales (product decision, 2026-10):
 * a manager-recorded figure is PENDING until an admin approves it, and a
 * revision returns it to PENDING. Approval never changes the figures — it is
 * workflow state, so historical rows are backfilled to APPROVED: nothing that
 * predates the gate should suddenly look unconfirmed.
 *
 * SALE_APPROVED / SALE_REJECTED notification values follow the same idempotent
 * pattern as AddNotificationTypes (PostgreSQL 12+ allows
 * `ALTER TYPE ... ADD VALUE` inside the migration transaction because the new
 * values are not used in the same transaction).
 */
export class AddSaleApproval1700000000005 implements MigrationInterface {
  name = 'AddSaleApproval1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SALE_APPROVED'`);
    await queryRunner.query(`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SALE_REJECTED'`);

    await queryRunner.query(
      `CREATE TYPE sale_approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(`
      ALTER TABLE sales
        ADD COLUMN approval_status sale_approval_status NOT NULL DEFAULT 'PENDING',
        ADD COLUMN approved_by UUID,
        ADD COLUMN approved_at TIMESTAMPTZ,
        ADD COLUMN rejection_reason TEXT
    `);
    await queryRunner.query(`UPDATE sales SET approval_status = 'APPROVED'`);
    await queryRunner.query(`CREATE INDEX sales_approval_status ON sales (approval_status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS sales_approval_status`);
    await queryRunner.query(`
      ALTER TABLE sales
        DROP COLUMN IF EXISTS approval_status,
        DROP COLUMN IF EXISTS approved_by,
        DROP COLUMN IF EXISTS approved_at,
        DROP COLUMN IF EXISTS rejection_reason
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS sale_approval_status`);

    // PostgreSQL cannot drop enum values without rewriting the type and all
    // dependent columns. The notification values are left in place: once no
    // code emits them, they are inert rows in the type definition.
  }
}
