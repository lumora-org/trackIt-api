import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the K.B.Y GLOBAL INVESTMENT MVP.
 *
 * Mirrors docs/03 (Database Design) and the schema requirements in PROMPT.md
 * §6/§7 and PROMPT-B.E §5. Every integrity rule that can live in the database
 * does: unique business-scoped codes, CHECK constraints on sign/precision, and
 * the fuel-price interval exclusion constraint.
 *
 * Where docs/03 and PROMPT-B.E disagree, PROMPT-B.E wins for the API-facing
 * shape and the deviation is documented inline.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() for defaults; btree_gist lets the price exclusion
    // constraint use `=` on uuid columns (docs/03 §6, docs/08 §21).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "btree_gist"`);

    await this.createEnums(queryRunner);
    await this.createIdentityTables(queryRunner);
    await this.createFuelCatalogue(queryRunner);
    await this.createSupplyChain(queryRunner);
    await this.createLedgerAndSales(queryRunner);
    await this.createReportingAndAudit(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS daily_reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS sales`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS delivery_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS deliveries`);
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_order_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_orders`);
    await queryRunner.query(`DROP TABLE IF EXISTS tankers`);
    await queryRunner.query(`DROP TABLE IF EXISTS suppliers`);
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_prices`);
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_types`);
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
    await queryRunner.query(`DROP TABLE IF EXISTS branches`);
    await queryRunner.query(`DROP TABLE IF EXISTS businesses`);

    await queryRunner.query(`DROP TYPE IF EXISTS notification_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS notification_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS daily_report_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS inventory_transaction_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS delivery_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS fuel_order_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS branch_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS business_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS account_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);
  }

  /** docs/03 §11–§20. Note branch_status deliberately has no SUSPENDED. */
  private async createEnums(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER')
    `);
    await queryRunner.query(`
      CREATE TYPE account_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED')
    `);
    await queryRunner.query(`
      CREATE TYPE business_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED')
    `);
    await queryRunner.query(`
      CREATE TYPE branch_status AS ENUM ('ACTIVE', 'INACTIVE')
    `);
    await queryRunner.query(`
      CREATE TYPE fuel_order_status AS ENUM (
        'DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_TRANSIT',
        'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE delivery_status AS ENUM ('PENDING', 'RECEIVED', 'DISPUTED', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE inventory_transaction_type AS ENUM (
        'OPENING_BALANCE', 'DELIVERY', 'SALE', 'ADJUSTMENT',
        'TRANSFER_IN', 'TRANSFER_OUT', 'CORRECTION'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE daily_report_status AS ENUM (
        'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE notification_type AS ENUM (
        'REPORT_SUBMITTED', 'REPORT_APPROVED', 'REPORT_REJECTED',
        'DELIVERY_RECEIVED', 'DELIVERY_DISCREPANCY', 'LOW_INVENTORY', 'SYSTEM'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE notification_status AS ENUM ('UNREAD', 'READ')
    `);
  }

  private async createIdentityTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE businesses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        registration_number VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(30),
        address TEXT,
        status business_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX businesses_id_unique ON businesses (id)`);

    await queryRunner.query(`
      CREATE TABLE branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        address TEXT NOT NULL,
        phone VARCHAR(30),
        status branch_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX branches_id_unique ON branches (id)`);
    // Two businesses may legitimately reuse a branch code (docs/03 §27).
    await queryRunner.query(
      `CREATE UNIQUE INDEX branches_business_id_code ON branches (business_id, code)`,
    );
    await queryRunner.query(`CREATE INDEX branches_business_id ON branches (business_id)`);

    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(30),
        avatar_url TEXT,
        password_hash TEXT NOT NULL,
        role user_role NOT NULL,
        status account_status NOT NULL DEFAULT 'ACTIVE',
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        -- Scope invariants from docs/03 §22, enforced in the database as well
        -- as the application: SUPER_ADMIN is platform-scoped, ADMIN is
        -- business-scoped, MANAGER is branch-scoped.
        CONSTRAINT users_scope_invariants CHECK (
          (role = 'SUPER_ADMIN' AND business_id IS NULL AND branch_id IS NULL)
          OR (role = 'ADMIN'      AND business_id IS NOT NULL AND branch_id IS NULL)
          OR (role = 'MANAGER'    AND business_id IS NOT NULL AND branch_id IS NOT NULL)
        ),
        -- Avatar is a data URL while we keep frontend parity (PROMPT-B.E §6.1).
        CONSTRAINT users_avatar_url_length CHECK (
          avatar_url IS NULL OR length(avatar_url) <= 3800000
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX users_id_unique ON users (id)`);
    // Case-insensitive email uniqueness (PROMPT.md §11).
    await queryRunner.query(`CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(email))`);
    await queryRunner.query(`CREATE INDEX users_business_id ON users (business_id)`);
    await queryRunner.query(`CREATE INDEX users_branch_id ON users (branch_id)`);

    // One refresh-token row per session; only the SHA-256 hash is stored.
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        user_agent TEXT,
        ip_address INET,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX refresh_tokens_id_unique ON refresh_tokens (id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX refresh_tokens_token_hash ON refresh_tokens (token_hash)`,
    );
    await queryRunner.query(`CREATE INDEX refresh_tokens_user_id ON refresh_tokens (user_id)`);
    await queryRunner.query(
      `CREATE INDEX refresh_tokens_expires_at ON refresh_tokens (expires_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX password_reset_tokens_id_unique ON password_reset_tokens (id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX password_reset_tokens_token_hash ON password_reset_tokens (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX password_reset_tokens_user_id ON password_reset_tokens (user_id)`,
    );
  }

  private async createFuelCatalogue(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE fuel_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(30) NOT NULL,
        description TEXT,
        status account_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        -- PROMPT-B.E §4.5: codes are uppercase identifiers (docs/08 §70).
        CONSTRAINT fuel_types_code_format CHECK (code ~ '^[A-Z0-9_-]+$')
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX fuel_types_id_unique ON fuel_types (id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX fuel_types_business_id_code ON fuel_types (business_id, code)`,
    );
    await queryRunner.query(`CREATE INDEX fuel_types_business_id ON fuel_types (business_id)`);
    await queryRunner.query(`CREATE INDEX fuel_types_status ON fuel_types (status)`);

    await queryRunner.query(`
      CREATE TABLE fuel_prices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE RESTRICT,
        price_per_litre NUMERIC(18,2) NOT NULL,
        effective_from TIMESTAMPTZ NOT NULL,
        effective_to TIMESTAMPTZ,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fuel_prices_price_positive CHECK (price_per_litre > 0),
        CONSTRAINT fuel_prices_interval_ordered CHECK (
          effective_to IS NULL OR effective_to > effective_from
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX fuel_prices_id_unique ON fuel_prices (id)`);
    await queryRunner.query(
      `CREATE INDEX fuel_prices_business_id_fuel_type_id ON fuel_prices (business_id, fuel_type_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX fuel_prices_effective_from ON fuel_prices (effective_from)`,
    );

    // The database is the final authority on price-period overlap
    // (docs/08 §20–§21). Half-open '[)' ranges mean start inclusive and end
    // exclusive, and an open interval (effective_to NULL) becomes an unbounded
    // range which still conflicts — so there can never be two active prices.
    //
    // PROMPT-B.E §5 keys this on fuel_type_id alone; docs/03 §33, PROMPT.md §17
    // and docs/08 §21 key it on business_id + fuel_type_id. The latter is used:
    // it is strictly stronger and keeps the tenant boundary explicit.
    await queryRunner.query(`
      ALTER TABLE fuel_prices
      ADD CONSTRAINT fuel_prices_no_overlapping_periods
      EXCLUDE USING gist (
        business_id WITH =,
        fuel_type_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      )
    `);
  }

  private async createSupplyChain(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        contact_person VARCHAR(255),
        phone VARCHAR(30),
        email VARCHAR(255),
        address TEXT,
        status account_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX suppliers_id_unique ON suppliers (id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX suppliers_business_id_code ON suppliers (business_id, code)`,
    );
    await queryRunner.query(`CREATE INDEX suppliers_business_id ON suppliers (business_id)`);

    await queryRunner.query(`
      CREATE TABLE tankers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        registration_number VARCHAR(50) NOT NULL,
        tanker_code VARCHAR(50),
        capacity_litres NUMERIC(18,3) NOT NULL,
        driver_name VARCHAR(255),
        driver_phone VARCHAR(30),
        status account_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT tankers_capacity_positive CHECK (capacity_litres > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX tankers_id_unique ON tankers (id)`);
    // Registration numbers compare case-insensitively (PROMPT-B.E §4.8).
    await queryRunner.query(
      `CREATE UNIQUE INDEX tankers_business_id_registration
         ON tankers (business_id, UPPER(registration_number))`,
    );
    await queryRunner.query(`CREATE INDEX tankers_business_id ON tankers (business_id)`);

    await queryRunner.query(`
      CREATE TABLE fuel_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(50) NOT NULL,
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        destination_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        status fuel_order_status NOT NULL DEFAULT 'DRAFT',
        ordered_at TIMESTAMPTZ,
        expected_delivery_at TIMESTAMPTZ NOT NULL,
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        cancelled_at TIMESTAMPTZ,
        cancellation_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX fuel_orders_id_unique ON fuel_orders (id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX fuel_orders_business_id_order_number
         ON fuel_orders (business_id, order_number)`,
    );
    await queryRunner.query(`CREATE INDEX fuel_orders_business_id ON fuel_orders (business_id)`);
    await queryRunner.query(
      `CREATE INDEX fuel_orders_destination_branch_id ON fuel_orders (destination_branch_id)`,
    );
    await queryRunner.query(`CREATE INDEX fuel_orders_status ON fuel_orders (status)`);

    await queryRunner.query(`
      CREATE TABLE fuel_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fuel_order_id UUID NOT NULL REFERENCES fuel_orders(id) ON DELETE CASCADE,
        fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE RESTRICT,
        expected_quantity_litres NUMERIC(18,3) NOT NULL,
        unit_cost NUMERIC(18,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fuel_order_items_expected_quantity_positive
          CHECK (expected_quantity_litres > 0),
        CONSTRAINT fuel_order_items_unit_cost_positive CHECK (unit_cost > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX fuel_order_items_id_unique ON fuel_order_items (id)`,
    );
    await queryRunner.query(
      `CREATE INDEX fuel_order_items_fuel_order_id ON fuel_order_items (fuel_order_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_number VARCHAR(50),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        fuel_order_id UUID NOT NULL REFERENCES fuel_orders(id) ON DELETE RESTRICT,
        tanker_id UUID REFERENCES tankers(id) ON DELETE RESTRICT,
        destination_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        delivery_status delivery_status NOT NULL DEFAULT 'PENDING',
        delivered_at TIMESTAMPTZ,
        received_by UUID REFERENCES users(id) ON DELETE SET NULL,
        dispute_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX deliveries_id_unique ON deliveries (id)`);
    await queryRunner.query(`CREATE INDEX deliveries_business_id ON deliveries (business_id)`);
    await queryRunner.query(
      `CREATE INDEX deliveries_destination_branch_id ON deliveries (destination_branch_id)`,
    );
    await queryRunner.query(`CREATE INDEX deliveries_fuel_order_id ON deliveries (fuel_order_id)`);
    await queryRunner.query(`CREATE INDEX deliveries_delivered_at ON deliveries (delivered_at)`);
    await queryRunner.query(`CREATE INDEX deliveries_status ON deliveries (delivery_status)`);

    // Both columns are stored on purpose — see delivery-item.entity.ts.
    await queryRunner.query(`
      CREATE TABLE delivery_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
        fuel_order_item_id UUID NOT NULL REFERENCES fuel_order_items(id) ON DELETE RESTRICT,
        fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE RESTRICT,
        expected_quantity_litres NUMERIC(18,3) NOT NULL,
        actual_quantity_litres NUMERIC(18,3),
        difference_litres NUMERIC(18,3),
        discrepancy_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- Actual received quantity may legitimately be zero, never negative.
        CONSTRAINT delivery_items_actual_non_negative
          CHECK (actual_quantity_litres IS NULL OR actual_quantity_litres >= 0),
        -- difference is derived, so the database keeps it honest (docs/03 §41).
        CONSTRAINT delivery_items_difference_derived CHECK (
          difference_litres IS NULL
          OR (
            actual_quantity_litres IS NOT NULL
            AND difference_litres = actual_quantity_litres - expected_quantity_litres
          )
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX delivery_items_id_unique ON delivery_items (id)`);
    await queryRunner.query(
      `CREATE INDEX delivery_items_delivery_id ON delivery_items (delivery_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX delivery_items_fuel_order_item_id ON delivery_items (fuel_order_item_id)`,
    );
  }

  private async createLedgerAndSales(queryRunner: QueryRunner): Promise<void> {
    // The append-only ledger. There is deliberately no mutable current_stock
    // column anywhere: stock is always SUM(quantity_litres) (docs/03 §74, §92).
    await queryRunner.query(`
      CREATE TABLE inventory_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE RESTRICT,
        transaction_type inventory_transaction_type NOT NULL,
        quantity_litres NUMERIC(18,3) NOT NULL,
        balance_after NUMERIC(18,3) NOT NULL,
        reference_type VARCHAR(50) NOT NULL,
        reference_id UUID,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX inventory_transactions_id_unique ON inventory_transactions (id)`,
    );
    await queryRunner.query(
      `CREATE INDEX inventory_transactions_business_id_branch_id
         ON inventory_transactions (business_id, branch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX inventory_transactions_branch_id_fuel_type_id
         ON inventory_transactions (branch_id, fuel_type_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX inventory_transactions_occurred_at ON inventory_transactions (occurred_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX inventory_transactions_reference
         ON inventory_transactions (reference_type, reference_id)`,
    );
    // Hard guarantee against double-posting a delivery: a delivery may produce
    // at most one DELIVERY ledger row per fuel type, whatever the application
    // does (PROMPT.md §27, docs/09 §21).
    await queryRunner.query(`
      CREATE UNIQUE INDEX inventory_transactions_unique_delivery_posting
        ON inventory_transactions (reference_id, fuel_type_id)
        WHERE reference_type = 'DELIVERY' AND transaction_type = 'DELIVERY'
    `);

    await queryRunner.query(`
      CREATE TABLE sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_number VARCHAR(50) NOT NULL,
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE RESTRICT,
        litres_sold NUMERIC(18,3) NOT NULL,
        unit_price NUMERIC(18,2) NOT NULL,
        total_amount NUMERIC(18,2) NOT NULL,
        sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        voided_at TIMESTAMPTZ,
        void_reason TEXT,
        voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT sales_litres_sold_positive CHECK (litres_sold > 0),
        CONSTRAINT sales_unit_price_positive CHECK (unit_price > 0),
        CONSTRAINT sales_total_amount_non_negative CHECK (total_amount >= 0),
        -- A void requires a reason, so the audit trail is never ambiguous.
        CONSTRAINT sales_void_reason_required
          CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX sales_id_unique ON sales (id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX sales_business_id_sale_number ON sales (business_id, sale_number)`,
    );
    await queryRunner.query(
      `CREATE INDEX sales_business_id_branch_id ON sales (business_id, branch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX sales_branch_id_fuel_type_id ON sales (branch_id, fuel_type_id)`,
    );
    await queryRunner.query(`CREATE INDEX sales_sold_at ON sales (sold_at)`);
    await queryRunner.query(`CREATE INDEX sales_voided_at ON sales (voided_at)`);
  }

  private async createReportingAndAudit(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE daily_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        report_date DATE NOT NULL,
        status daily_report_status NOT NULL DEFAULT 'DRAFT',
        opening_stock_litres NUMERIC(18,3) NOT NULL DEFAULT 0,
        total_received_litres NUMERIC(18,3) NOT NULL DEFAULT 0,
        total_sold_litres NUMERIC(18,3) NOT NULL DEFAULT 0,
        closing_stock_litres NUMERIC(18,3) NOT NULL DEFAULT 0,
        total_revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
        manager_notes TEXT,
        submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        submitted_at TIMESTAMPTZ,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT daily_reports_quantities_non_negative
          CHECK (
            opening_stock_litres >= 0
            AND total_received_litres >= 0
            AND total_sold_litres >= 0
            AND closing_stock_litres >= 0
          ),
        CONSTRAINT daily_reports_revenue_non_negative CHECK (total_revenue >= 0),
        -- A rejection is only meaningful with a reason (docs/01 §19).
        CONSTRAINT daily_reports_rejection_requires_reason
          CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX daily_reports_id_unique ON daily_reports (id)`);
    // One report per branch per day (docs/03 §56).
    await queryRunner.query(
      `CREATE UNIQUE INDEX daily_reports_branch_id_report_date
         ON daily_reports (branch_id, report_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX daily_reports_business_id_branch_id ON daily_reports (business_id, branch_id)`,
    );
    await queryRunner.query(`CREATE INDEX daily_reports_status ON daily_reports (status)`);
    await queryRunner.query(
      `CREATE INDEX daily_reports_report_date ON daily_reports (report_date)`,
    );

    await queryRunner.query(`
      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type notification_type NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        status notification_status NOT NULL DEFAULT 'UNREAD',
        resource_type VARCHAR(50),
        resource_id UUID,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX notifications_id_unique ON notifications (id)`);
    // The unread badge polls status=UNREAD and reads meta.total (PROMPT-B.E §4.14).
    await queryRunner.query(
      `CREATE INDEX notifications_user_id_status_created_at
         ON notifications (user_id, status, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(100),
        resource_id UUID,
        old_values JSONB,
        new_values JSONB,
        metadata JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX audit_logs_id_unique ON audit_logs (id)`);
    await queryRunner.query(
      `CREATE INDEX audit_logs_business_id_user_id ON audit_logs (business_id, user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX audit_logs_resource_type_resource_id
         ON audit_logs (resource_type, resource_id)`,
    );
    await queryRunner.query(`CREATE INDEX audit_logs_created_at ON audit_logs (created_at)`);
    await queryRunner.query(`CREATE INDEX audit_logs_action ON audit_logs (action)`);

    // Append-only defence in depth: the API exposes no mutating route, and the
    // database refuses UPDATE/DELETE for the application role as well.
    await queryRunner.query(`REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC`);

    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        key VARCHAR(255) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        request_hash VARCHAR(64) NOT NULL,
        response_status INT,
        response_snapshot JSONB,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idempotency_keys_user_id ON idempotency_keys (user_id)`);
    await queryRunner.query(
      `CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idempotency_keys_expires_at ON idempotency_keys (expires_at)`,
    );
  }
}
