import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  CheckoutStatus,
  Currency,
  FarmVerificationStatus,
  OrderStatus,
  PaymentStatus,
  ProduceStatus,
  RefundStatus,
  Role,
  type Farm,
  type Lga,
  type State,
  type User,
} from '../generated/client';
import { CheckoutService } from '../src/cart/checkout.service';
import { addDays, lagosToday } from '../src/common/dates';
import { FxConfig } from '../src/fx/fx.config';
import { FxService } from '../src/fx/fx.service';
import type {
  PaystackClient,
  VerifiedTransaction,
} from '../src/paystack/paystack.client';
import { PaystackConfig } from '../src/paystack/paystack.config';
import { CheckoutExpiryService } from '../src/payment/checkout-expiry.service';
import { PaymentService } from '../src/payment/payment.service';
import { RefundService } from '../src/payment/refund.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import { PrismaService } from '../src/prisma/prisma.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Every row is tagged with this run's id and removed
// in afterAll.
const run = randomUUID().slice(0, 8);

describe('Payment concurrency (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const config = testCheckoutConfig();
  const checkouts = new CheckoutService(db, config);
  const paystack = {
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/e2e',
      accessCode: 'e2e',
    }),
    createRefund: jest.fn().mockResolvedValue({ id: 'rf-e2e' }),
  };
  const client = paystack as unknown as PaystackClient;
  const payments = new PaymentService(
    db,
    client,
    new PaystackConfig(
      new ConfigService({
        PAYSTACK_SECRET_KEY: 'sk_test_e2e',
        PAYSTACK_CALLBACK_URL: 'http://localhost:3000/cb',
      }),
    ),
    new FxService(
      db,
      new FxConfig(new ConfigService({ OPEN_EXCHANGE_RATES_APP_ID: 'e2e' })),
    ),
    new RefundService(db, client),
  );
  const expiry = new CheckoutExpiryService(db);
  const buyerIds: string[] = [];
  let farmerUser: User;
  let state: State;
  let lga: Lga;
  let farm: Farm;

  const charged = (reference: string, naira: number): VerifiedTransaction => ({
    reference,
    status: 'success',
    amount: naira * 100,
    currency: 'NGN',
    channel: 'card',
  });

  function user(role: Role) {
    const tag = `${run}-${randomUUID()}`;
    return db.user.create({
      data: {
        firebaseUid: `e2e-${tag}`,
        email: `e2e-${tag}@example.com`,
        firstName: 'E2E',
        lastName: role,
        role,
        isVerified: true,
      },
    });
  }

  async function buyer() {
    const created = await user(Role.BUYER);
    buyerIds.push(created.id);
    return created;
  }

  function produce(stock: number) {
    return db.produce.create({
      data: {
        farmId: farm.id,
        name: `E2E produce ${run}`,
        quantity: stock,
        actualQuantity: stock,
        floatingQuantity: stock,
        unit: 'kg',
        pricePerUnit: '100.00',
        status: ProduceStatus.PUBLISHED,
      },
    });
  }

  // A buyer with `quantity` of a fresh 10-unit listing checked out, unpaid.
  async function placed(quantity: number) {
    const listing = await produce(10);
    const owner = await buyer();
    await db.cartItem.create({
      data: { buyerId: owner.id, produceId: listing.id, quantity },
    });
    const address = await db.address.create({
      data: {
        buyerId: owner.id,
        label: 'E2E',
        street: '1 Test Road',
        stateId: state.id,
        lgaId: lga.id,
        isDefault: true,
      },
    });
    const checkout = await checkouts.checkout(owner, randomUUID(), {
      expectedTotal: quantity * 100 + 3500,
      addressId: address.id,
      deliveryDate: addDays(lagosToday(), 2),
    });
    return { owner, listing, checkout, total: quantity * 100 + 3500 };
  }

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    farmerUser = await user(Role.FARMER);
    const farmer = await db.farmer.create({ data: { userId: farmerUser.id } });
    farm = await db.farm.create({
      data: {
        ownerId: farmer.id,
        name: `E2E Farm ${run}`,
        stateId: state.id,
        lgaId: lga.id,
        location: '1 Test Road',
        size: 1,
        mainProduce: 'Maize',
        verificationStatus: FarmVerificationStatus.VERIFIED,
      },
    });
  });

  afterAll(async () => {
    const mine = { buyerId: { in: buyerIds } };
    await db.refund.deleteMany({ where: { payment: { checkout: mine } } });
    await db.payment.deleteMany({ where: { checkout: mine } });
    await db.order.deleteMany({ where: mine });
    await db.checkout.deleteMany({ where: mine });
    await db.cartItem.deleteMany({ where: mine });
    await db.address.deleteMany({ where: mine });
    await db.farm.delete({ where: { id: farm.id } });
    await db.user.deleteMany({
      where: { id: { in: [...buyerIds, farmerUser.id] } },
    });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  it('settles a charge racing the sweep one way only', async () => {
    const { owner, listing, checkout, total } = await placed(4);
    const payment = await payments.initiate(owner, checkout.id, randomUUID(), {
      currency: Currency.NGN,
    });
    await db.checkout.update({
      where: { id: checkout.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await Promise.all([
      payments.applyVerifiedCharge(charged(payment.reference, total), null),
      expiry.expireOverdue(),
    ]);

    const after = await db.checkout.findUniqueOrThrow({
      where: { id: checkout.id },
      include: { orders: true, payments: { include: { refunds: true } } },
    });
    const stock = await db.produce.findUniqueOrThrow({
      where: { id: listing.id },
    });
    if (after.status === CheckoutStatus.PAID) {
      expect(after.orders.map((o) => o.status)).toEqual([OrderStatus.PENDING]);
      expect(after.payments[0].status).toBe(PaymentStatus.SUCCEEDED);
      expect(stock.floatingQuantity).toBe(6);
    } else {
      expect(after.status).toBe(CheckoutStatus.EXPIRED);
      expect(after.orders.map((o) => o.status)).toEqual([
        OrderStatus.CANCELLED,
      ]);
      expect(after.payments[0].status).toBe(PaymentStatus.ORPHANED);
      expect(after.payments[0].refunds.map((r) => r.status)).toEqual([
        RefundStatus.PENDING,
      ]);
      expect(stock.floatingQuantity).toBe(10);
    }
  });

  it('pays once when the same charge is applied twice at once', async () => {
    const { owner, checkout, total } = await placed(2);
    const payment = await payments.initiate(owner, checkout.id, randomUUID(), {
      currency: Currency.NGN,
    });

    const results = await Promise.all([
      payments.applyVerifiedCharge(charged(payment.reference, total), null),
      payments.applyVerifiedCharge(charged(payment.reference, total), null),
    ]);

    expect(results.map((r) => r?.status)).toEqual([
      PaymentStatus.SUCCEEDED,
      PaymentStatus.SUCCEEDED,
    ]);
    await expect(
      db.payment.count({
        where: { checkoutId: checkout.id, status: PaymentStatus.SUCCEEDED },
      }),
    ).resolves.toBe(1);
    const after = await db.checkout.findUniqueOrThrow({
      where: { id: checkout.id },
      include: { orders: true },
    });
    expect(after.status).toBe(CheckoutStatus.PAID);
    expect(after.orders.map((o) => o.status)).toEqual([OrderStatus.PENDING]);
  });

  it('restores stock when the hold runs out, even while another buyer reserves', async () => {
    const { listing, checkout } = await placed(4);
    const other = await buyer();
    const address = await db.address.create({
      data: {
        buyerId: other.id,
        label: 'E2E',
        street: '1 Test Road',
        stateId: state.id,
        lgaId: lga.id,
        isDefault: true,
      },
    });
    await db.cartItem.create({
      data: { buyerId: other.id, produceId: listing.id, quantity: 3 },
    });
    await db.checkout.update({
      where: { id: checkout.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await Promise.all([
      expiry.expireOverdue(),
      checkouts.checkout(other, randomUUID(), {
        expectedTotal: 300 + 3500,
        addressId: address.id,
        deliveryDate: addDays(lagosToday(), 2),
      }),
    ]);

    const stock = await db.produce.findUniqueOrThrow({
      where: { id: listing.id },
    });
    // 10 - 4 (expired, returned) - 3 (other buyer) = 7: neither change lost.
    expect(stock.floatingQuantity).toBe(7);
    expect(stock.status).toBe(ProduceStatus.PUBLISHED);
  });
});
