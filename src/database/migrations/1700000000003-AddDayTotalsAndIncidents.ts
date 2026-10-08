import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Day-total sales + incident reports (product decision, 2026-10).
 *
 * 1. `sale_record_mode` distinguishes one counter transaction (SINGLE) from
 *    the manager's running total for a business day (DAY_TOTAL). A partial
 *    unique index keeps at most one ACTIVE day-total row per branch, fuel and
 *    business day — day-total rows carry sold_at = noon of the business day,
 *    so `sold_at` alone identifies the day. Voided rows are excluded so a
 *    cleared day can be recorded again.
 *
 * 2. `incident_reports` is the branch's free-text exception log that replaced
 *    the manager's financial daily report.
 *
 * 3. Three notification types are added for the new flows. Same idempotent
 *    pattern as AddNotificationTypes (PostgreSQL 12+ allows
 *    `ALTER TYPE ... ADD VALUE` inside the migration transaction because the
 *    new values are not used in the same transaction).
 */
export class AddDayTotalsAndIncidents1700000000003 implements MigrationInterface {
  name = 'AddDayTotalsAndIncidents1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'INCIDENT_REPORTED'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'INCIDENT_REVIEWED'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SALES_NOT_RECORDED'`,
    );

    await queryRunner.query(`CREATE TYPE sale_record_mode AS ENUM ('SINGLE', 'DAY_TOTAL')`);
    await queryRunner.query(`
      ALTER TABLE sales
        ADD COLUMN record_mode sale_record_mode NOT NULL DEFAULT 'SINGLE'
    `);
    // At most one ACTIVE day-total row per branch, fuel and business day. The
    // noon convention pins every DAY_TOTAL row to the same instant of its day,
    // so (branch, fuel, sold_at) is exactly (branch, fuel, day).
    await queryRunner.query(`
      CREATE UNIQUE INDEX sales_day_total_unique
        ON sales (branch_id, fuel_type_id, sold_at)
        WHERE record_mode = 'DAY_TOTAL' AND voided_at IS NULL
    `);

    await queryRunner.query(`CREATE TYPE incident_report_status AS ENUM ('OPEN', 'REVIEWED')`);
    await queryRunner.query(`
      CREATE TABLE incident_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        incident_date DATE NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        status incident_report_status NOT NULL DEFAULT 'OPEN',
        reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- A REVIEWED incident must carry the moment it was reviewed.
        CONSTRAINT incident_reports_reviewed_requires_reviewed_at
          CHECK (status <> 'REVIEWED' OR reviewed_at IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX incident_reports_id_unique ON incident_reports (id)`,
    );
    await queryRunner.query(
      `CREATE INDEX incident_reports_business_id_branch_id
         ON incident_reports (business_id, branch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX incident_reports_branch_id_incident_date
         ON incident_reports (branch_id, incident_date)`,
    );
    await queryRunner.query(`CREATE INDEX incident_reports_status ON incident_reports (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS incident_reports`);
    await queryRunner.query(`DROP TYPE IF EXISTS incident_report_status`);

    await queryRunner.query(`DROP INDEX IF EXISTS sales_day_total_unique`);
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS record_mode`);
    await queryRunner.query(`DROP TYPE IF EXISTS sale_record_mode`);

    // PostgreSQL cannot drop enum values without rewriting the type and all
    // dependent columns. The notification values are left in place: once no
    // code emits them, they are inert rows in the type definition.
  }
}
