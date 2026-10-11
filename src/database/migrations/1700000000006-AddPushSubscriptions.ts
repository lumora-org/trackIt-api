import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Web Push subscriptions for the installed PWA.
 *
 * One row per browser/device a user opted in on. `endpoint` is unique because
 * the push service issues exactly one URL per subscription, so a reload that
 * re-registers the same device updates the row instead of piling up duplicates
 * that would each receive the same alert.
 */
export class AddPushSubscriptions1700000000006 implements MigrationInterface {
  name = 'AddPushSubscriptions1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint VARCHAR(2048) NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        user_agent VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX push_subscriptions_endpoint ON push_subscriptions (endpoint)`,
    );
    await queryRunner.query(
      `CREATE INDEX push_subscriptions_user_id ON push_subscriptions (user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS push_subscriptions_user_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS push_subscriptions`);
  }
}
