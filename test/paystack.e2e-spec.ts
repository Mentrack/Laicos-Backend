// test/paystack.e2e-spec.ts
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  CheckoutStatus,
  Currency,
  FarmVerificationStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  ProduceStatus,
  Role,
  type Farm,
  type Farmer,
  type Lga,
  type State,
  type User,
} from '../generated/client';
import { CheckoutService } from '../src/cart/checkout.service';
import { addDays, lagosToday } from '../src/common/dates';
import { FxConfig } from '../src/fx/fx.config';
import { FxService } from '../src/fx/fx.service';
import type { PaystackClient } from '../src/paystack/paystack.client';
import { PaystackConfig } from '../src/paystack/paystack.config';
import { PaymentService } from '../src/payment/payment.service';
import { PaystackEventsService } from '../src/payment/paystack-events.service';
import { RefundService } from '../src/payment/refund.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import type { PayoutService } from '../src/payout/payout.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Paystack itself is mocked.
const run = randomUUID().slice(0, 8);

describe('Paystack (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const config = testCheckoutConfig({ SERVICE_FEE_PERCENT: '5' });
  const checkouts = new CheckoutService(db, config);
  const paystack = {
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/e2e',
      accessCode: 'e2e',
    }),
    verifyTransaction: jest.fn(),
    createRefund: jest.fn().mockResolvedValue({ id: 'rf-e2e' }),
  };
  const client = paystack as unknown as PaystackClient;
  const refunds = new RefundService(db, client);
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
    refunds,
  );
  const events = new PaystackEventsService(client, payments, refunds, {
    applyTransferResult: jest.fn(),
  } as unknown as PayoutService);
  const userIds: string[] = [];
  let buyer: User;
  let admin: User;
  let farmer: Farmer;
  let state: State;
  let lga: Lga;
  let farm: Farm;

  async function user(role: Role) {
    const tag = `${run}-${randomUUID()}`;
    const created = await db.user.create({
      data: {
        firebaseUid: `e2e-${tag}`,
        email: `e2e-${tag}@example.com`,
        firstName: 'E2E',
        lastName: role,
        role,
        isVerified: true,
      },
    });
    userIds.push(created.id);
    return created;
  }

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    const farmerUser = await user(Role.FARMER);
    farmer = await db.farmer.create({ data: { userId: farmerUser.id } });
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
    buyer = await user(Role.BUYER);
    admin = await user(Role.ADMIN);
  });

  afterAll(async () => {
    const mine = { buyerId: buyer.id };
    await db.payoutItem.deleteMany({
      where: { payout: { farmerId: farmer.id } },
    });
    await db.payout.deleteMany({ where: { farmerId: farmer.id } });
    await db.farmerBankAccount.deleteMany({ where: { farmerId: farmer.id } });
    await db.refund.deleteMany({ where: { payment: { checkout: mine } } });
    await db.payment.deleteMany({ where: { checkout: mine } });
    await db.order.deleteMany({ where: mine });
    await db.checkout.deleteMany({ where: mine });
    await db.cartItem.deleteMany({ where: mine });
    await db.address.deleteMany({ where: mine });
    await db.produce.deleteMany({ where: { farmId: farm.id } });
    await db.farm.delete({ where: { id: farm.id } });
    await db.farmer.delete({ where: { id: farmer.id } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  async function placed() {
    const listing = await db.produce.create({
      data: {
        farmId: farm.id,
        name: `E2E produce ${run}`,
        quantity: 10,
        actualQuantity: 10,
        floatingQuantity: 10,
        unit: 'kg',
        pricePerUnit: '100.00',
        status: ProduceStatus.PUBLISHED,
      },
    });
    await db.cartItem.create({
      data: { buyerId: buyer.id, produceId: listing.id, quantity: 4 },
    });
    const address = await db.address.create({
      data: {
        buyerId: buyer.id,
        label: 'E2E',
        street: '1 Test Road',
        stateId: state.id,
        lgaId: lga.id,
      },
    });
    // 400 items + 3500 delivery + 20 service fee (5%).
    return checkouts.checkout(buyer, randomUUID(), {
      expectedTotal: 3920,
      addressId: address.id,
      deliveryDate: addDays(lagosToday(), 2),
    });
  }

  it('prices the service fee into the checkout', async () => {
    const checkout = await placed();
    expect(checkout).toMatchObject({
      subtotal: '400.00',
      deliveryFee: '3500.00',
      serviceFee: '20.00',
      totalPrice: '3920.00',
    });
  });

  it('pays a checkout from a charge.success event', async () => {
    const checkout = await placed();
    const payment = await payments.initiate(buyer, checkout.id, randomUUID(), {
      currency: Currency.NGN,
    });
    paystack.verifyTransaction.mockResolvedValueOnce({
      reference: payment.reference,
      status: 'success',
      amount: 392_000,
      currency: 'NGN',
      channel: 'bank_transfer',
    });

    await events.handle({
      event: 'charge.success',
      data: { reference: payment.reference },
    });

    const after = await db.checkout.findUniqueOrThrow({
      where: { id: checkout.id },
      include: { orders: true, payments: true },
    });
    expect(after.status).toBe(CheckoutStatus.PAID);
    expect(after.orders.map((o) => o.status)).toEqual([OrderStatus.PENDING]);
    expect(after.payments[0]).toMatchObject({
      status: PaymentStatus.SUCCEEDED,
      channel: 'bank_transfer',
    });
  });

  it('lets the database refuse an order in two live payouts', async () => {
    const checkout = await placed();
    const [order] = checkout.orders;
    const payout = (status: PayoutStatus) =>
      db.payout.create({
        data: {
          farmerId: farmer.id,
          amount: '400.00',
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'E2E',
          recipientCode: 'RCP_e2e',
          approvedById: admin.id,
          status,
          items: { create: [{ orderId: order.id, amount: '400.00', status }] },
        },
      });
    await payout(PayoutStatus.FAILED);
    await payout(PayoutStatus.PENDING);
    await expect(payout(PayoutStatus.PENDING)).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});
