/**
 * Development seed for the sponsor demonstration scenario (docs/01 §41).
 *
 * Creates the exact chain the demo walks through:
 *
 *   K.B.Y GLOBAL INVESTMENT
 *     -> KBY Ikeja / KBY Yaba / KBY Lekki, each with a manager
 *     -> PMS / AGO / DPK fuel types
 *     -> a supplier and a tanker
 *     -> an order, a tanker delivery, an actual 44,850 L receipt, an 8,500 L
 *        sale at N1,500 and a daily report
 *
 * Every password is the same well-known development value and MUST NOT be used
 * anywhere real (PROMPT.md §52).
 *
 * Run with: npm run seed
 */
import { DataSource } from 'typeorm';
import { hash } from '@node-rs/argon2';
import 'dotenv/config';
import { ENTITIES } from '../entities';
import {
  AccountStatus,
  BranchStatus,
  BusinessStatus,
  DeliveryStatus,
  FuelOrderStatus,
  InventoryTransactionType,
  UserRole,
} from '../../common/enums';
import { DecimalMath } from '../../common/utils/money.util';

export const DEMO_PASSWORD = 'Password123!';

const BUSINESS_NAME = 'K.B.Y GLOBAL INVESTMENT';

const money = (value: string | number): string =>
  DecimalMath.toFixedString(
    DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.MONEY_SCALE),
    DecimalMath.MONEY_SCALE,
  );

const litres = (value: string | number): string =>
  DecimalMath.toFixedString(
    DecimalMath.rescale(DecimalMath.parse(value), DecimalMath.QUANTITY_SCALE),
    DecimalMath.QUANTITY_SCALE,
  );

async function run(dataSource: DataSource): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD);

  await dataSource.transaction(async (manager) => {
    const existing = await manager
      .getRepository('businesses')
      .createQueryBuilder('b')
      .where('b.name = :name', { name: BUSINESS_NAME })
      .getOne();

    if (existing) {
      console.log(`Business "${BUSINESS_NAME}" already exists (${existing.id}). Nothing seeded.`);
      return;
    }

    // ── Business ────────────────────────────────────────────────────────────
    const business = await manager.getRepository('businesses').save({
      name: BUSINESS_NAME,
      registrationNumber: 'RC123456',
      email: 'info@kbyglobal.com',
      phone: '+2348055332211',
      address: 'Birnin Gwari, Kaduna',
      status: BusinessStatus.ACTIVE,
    });
    const businessId: string = business.id;

    // ── Platform administrator (business_id and branch_id both NULL) ─────────
    await manager.getRepository('users').save({
      businessId: null,
      branchId: null,
      firstName: 'Ahmad',
      lastName: 'Abdul',
      email: 'superadmin@kbyglobal.com',
      phone: '+2349063801889',
      avatarUrl: null,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      lastLoginAt: null,
    });

    // ── Business administrator (business-scoped, no branch) ─────────────────
    const admin = await manager.getRepository('users').save({
      businessId,
      branchId: null,
      firstName: 'Kabiru',
      lastName: '2c',
      email: 'admin@kbyglobal.com',
      phone: '+2348199887755',
      avatarUrl: null,
      passwordHash,
      role: UserRole.ADMIN,
      status: AccountStatus.ACTIVE,
      lastLoginAt: null,
    });

    // ── Branches and their managers ────────────────────────────────────────
    const branchSpecs = [
      {
        code: 'KBY-BG',
        name: 'KBY Birnin-Gwari',
        address: 'Birnin Gwari, Kaduna',
        email: 'bg@kbyglobal.com',
      },
      { code: 'KBY-DKA', name: 'KBY Doka', address: 'Doka, Birnin Gwari', email: 'doka@kbyglobal.com' },
      {
        code: 'KBY-MND',
        name: 'KBY Mando',
        address: 'Mando, Birnin Gwari',
        email: 'mando@kbyglobal.com',
      },
    ];

    const branches: Array<{ id: string; code: string; name: string }> = [];

    for (const [index, spec] of branchSpecs.entries()) {
      const branch = await manager.getRepository('branches').save({
        businessId,
        name: spec.name,
        code: spec.code,
        address: spec.address,
        phone: `+234800000001${index}`,
        status: BranchStatus.ACTIVE,
      });

      await manager.getRepository('users').save({
        businessId,
        branchId: branch.id,
        firstName: 'Branch',
        lastName: `Manager ${spec.code.split('-')[1]}`,
        email: spec.email,
        phone: `+234800000002${index}`,
        avatarUrl: null,
        passwordHash,
        role: UserRole.MANAGER,
        status: AccountStatus.ACTIVE,
        lastLoginAt: null,
      });

      branches.push({ id: branch.id, code: spec.code, name: spec.name });
    }

    const bg = branches[0];

    // ── Fuel types ─────────────────────────────────────────────────────────
    const fuelTypeSpecs = [
      { code: 'PMS', name: 'Premium Motor Spirit', description: 'Petrol' },
      { code: 'AGO', name: 'Automotive Gas Oil', description: 'Diesel' },
      { code: 'DPK', name: 'Dual Purpose Kerosene', description: 'Kerosene' },
    ];

    const fuelTypes: Record<string, string> = {};
    for (const spec of fuelTypeSpecs) {
      const fuelType = await manager.getRepository('fuel_types').save({
        businessId,
        name: spec.name,
        code: spec.code,
        description: spec.description,
        status: AccountStatus.ACTIVE,
      });
      fuelTypes[spec.code] = fuelType.id;
    }

    // ── Price history: 1 Oct 1,500 / 10 Oct 1,550 / 18 Oct 1,600 (docs/08 §32)
    const year = new Date().getUTCFullYear();
    const priceWindows = [
      { from: `${year}-10-01T00:00:00.000Z`, to: `${year}-10-10T00:00:00.000Z`, price: '1500.00' },
      { from: `${year}-10-10T00:00:00.000Z`, to: `${year}-10-18T00:00:00.000Z`, price: '1550.00' },
      { from: `${year}-10-18T00:00:00.000Z`, to: null, price: '1600.00' },
    ];

    for (const window of priceWindows) {
      await manager.getRepository('fuel_prices').save({
        businessId,
        fuelTypeId: fuelTypes.PMS,
        pricePerLitre: money(window.price),
        effectiveFrom: new Date(window.from),
        effectiveTo: window.to ? new Date(window.to) : null,
        createdBy: admin.id,
      });
    }

    // ── Supplier and tanker ────────────────────────────────────────────────
    const supplier = await manager.getRepository('suppliers').save({
      businessId,
      name: 'ABC Petroleum',
      code: 'SUP-001',
      contactPerson: 'Adebayo Okonkwo',
      phone: '+2348000000030',
      email: 'orders@abcpetroleum.example',
      address: 'Lagos, Nigeria',
      status: AccountStatus.ACTIVE,
    });

    const tanker = await manager.getRepository('tankers').save({
      businessId,
      registrationNumber: 'ABC-123-LA',
      tankerCode: 'TANK-001',
      capacityLitres: litres('45000'),
      driverName: 'Chidi Nwosu',
      driverPhone: '+2348000000031',
      status: AccountStatus.ACTIVE,
    });

    // ── Opening balances so branches have stock to sell ─────────────────────
    //
    // KBY Ikeja PMS deliberately opens at ZERO. The sponsor demonstration in
    // docs/01 §41 ends on "Remaining: 36,350 L", which is exactly
    // 44,850 received - 8,500 sold, i.e. it assumes no opening stock on that
    // branch. Seeding a PMS opening balance there would make the demo display
    // 46,350 L and diverge from the documented acceptance figure. The other
    // branches and the Ikeja AGO grade keep opening stock so the dashboard and
    // branch comparison still have something to show.
    const openingBalances: Array<{ branchId: string; fuelTypeId: string; quantity: string }> = [
      { branchId: bg.id, fuelTypeId: fuelTypes.AGO, quantity: '12000' },
      { branchId: branches[1].id, fuelTypeId: fuelTypes.PMS, quantity: '8000' },
      { branchId: branches[2].id, fuelTypeId: fuelTypes.PMS, quantity: '6000' },
    ];

    for (const balance of openingBalances) {
      await manager.getRepository('inventory_transactions').save({
        businessId,
        branchId: balance.branchId,
        fuelTypeId: balance.fuelTypeId,
        transactionType: InventoryTransactionType.OPENING_BALANCE,
        quantityLitres: litres(balance.quantity),
        balanceAfter: litres(balance.quantity),
        referenceType: InventoryTransactionType.OPENING_BALANCE,
        referenceId: null,
        occurredAt: new Date(`${year}-10-01T00:00:00.000Z`),
        createdBy: admin.id,
        notes: 'Opening balance',
      });
    }

    // ── Fuel order: 45,000 L PMS to Ikeja (docs/01 §41 steps 4-5) ──────────
    const order = await manager.getRepository('fuel_orders').save({
      orderNumber: `ORD-${year}-000001`,
      businessId,
      supplierId: supplier.id,
      destinationBranchId: bg.id,
      status: FuelOrderStatus.IN_TRANSIT,
      orderedAt: new Date(`${year}-10-02T09:00:00.000Z`),
      expectedDeliveryAt: new Date(`${year}-10-06T10:00:00.000Z`),
      notes: 'Morning delivery',
      createdBy: admin.id,
      cancelledAt: null,
      cancellationReason: null,
    });

    const orderItem = await manager.getRepository('fuel_order_items').save({
      fuelOrderId: order.id,
      fuelTypeId: fuelTypes.PMS,
      expectedQuantityLitres: litres('45000'),
      unitCost: money('1200'),
    });

    // ── Delivery: expected 45,000, actually received 44,850 (short by 150) ──
    const delivery = await manager.getRepository('deliveries').save({
      deliveryNumber: `DEL-${year}-000001`,
      businessId,
      fuelOrderId: order.id,
      tankerId: tanker.id,
      destinationBranchId: bg.id,
      status: DeliveryStatus.PENDING,
      deliveredAt: null,
      receivedBy: null,
      disputeReason: null,
      notes: null,
    });

    await manager.getRepository('delivery_items').save({
      deliveryId: delivery.id,
      fuelOrderItemId: orderItem.id,
      fuelTypeId: fuelTypes.PMS,
      expectedQuantityLitres: litres('45000'),
      actualQuantityLitres: null,
      differenceLitres: null,
      discrepancyReason: null,
    });

    // ── eslint-disable-next-line no-console
    console.log(`
Seeded ${BUSINESS_NAME}.

  Demo accounts (all share the password ${DEMO_PASSWORD}):
    SUPER_ADMIN  superadmin@kbyglobal.com
    ADMIN        admin@kbyglobal.com
    MANAGER      bg@kbyglobal.com  (KBY Birnin-Gwari)
                 doka@kbyglobal.com   (KBY Doka)
                 mando@kbyglobal.com  (KBY Mando)

  Branches   ${branches.map((b) => b.code).join(', ')}
  Fuel types ${fuelTypeSpecs.map((f) => f.code).join(', ')}

  Pending delivery ${delivery.deliveryNumber ?? delivery.id} is ready to receive:
  expected 45,000 L, and the demo receiving screen enters 44,850 L, which
  records a -150 L discrepancy and leaves 44,850 L in stock.
`);
  });
}

async function main(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    console.error('Refusing to seed a production database.');
    process.exitCode = 1;
    return;
  }

  const dataSource = new DataSource({
    type: 'postgres',
    ...(process.env.DATABASE_URL
      ? { url: process.env.DATABASE_URL }
      : {
          host: process.env.DATABASE_HOST ?? 'localhost',
          port: Number(process.env.DATABASE_PORT ?? 5432),
          username: process.env.DATABASE_USER ?? 'postgres',
          password: process.env.DATABASE_PASSWORD ?? '',
          database: process.env.DATABASE_NAME ?? 'trackit',
        }),
    entities: ENTITIES,
    synchronize: false,
    logging: ['error'],
  });

  await dataSource.initialize();

  try {
    await run(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

void main();
