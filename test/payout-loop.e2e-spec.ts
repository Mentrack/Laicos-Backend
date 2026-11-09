import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Currency,
  FarmVerificationStatus,
  OrderStatus,
  PayeeRole,
  PayoutItemKind,
  PayoutStatus,
  ProduceStatus,
  RefundStatus,
  Role,
  type Agent,
  type Farm,
  type Farmer,
  type Lga,
  type Order,
  type State,
  type User,
} from '../generated/client';
import { AuditService } from '../src/audit/audit.service';
import { CheckoutService } from '../src/cart/checkout.service';
import { addDays, lagosToday } from '../src/common/dates';
import { DisputeService } from '../src/dispute/dispute.service';
import { FxConfig } from '../src/fx/fx.config';
import { FxService } from '../src/fx/fx.service';
import { HandoverService } from '../src/handover/handover.service';
import { NotificationService } from '../src/notifications/notification.service';
import { OrderService } from '../src/order/order.service';
import type {
  PaystackClient,
  TransferOrder,
} from '../src/paystack/paystack.client';
import { PaystackConfig } from '../src/paystack/paystack.config';
import { PaymentService } from '../src/payment/payment.service';
import { PaystackEventsService } from '../src/payment/paystack-events.service';
import { RefundService } from '../src/payment/refund.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import { PayoutRunService } from '../src/payout/payout-run.service';
import { PayoutConfig } from '../src/payout/payout.config';
import { PayoutService } from '../src/payout/payout.service';
import { PrismaService } from '../src/prisma/prisma.service';
import type { StorageService } from '../src/storage/storage.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Paystack is mocked. Rows are tagged with this run's
// id and removed in afterAll.
const run = randomUUID().slice(0, 8);
const HOUR_MS = 3_600_000;
// The payout run pays every eligible order in the database. Running it at an
// instant long before any real data, with only this suite's bank accounts
// released by then, keeps it to this suite's orders.
const RUN_AT = new Date('2001-01-10T12:00:00Z');

describe('Delivery, disputes and the payout run (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const checkoutConfig = testCheckoutConfig({
    SERVICE_FEE_PERCENT: '5',
    AGENT_COMMISSION_PERCENT: '5',
  });
  const payoutConfig = new PayoutConfig(
    new ConfigService({ PAYOUT_HOLD_HOURS: '24', PAYOUT_RUN_MINUTES: '60' }),
  );
  const paystack = {
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/e2e',
      accessCode: 'e2e',
    }),
    verifyTransaction: jest.fn(),
    createRefund: jest.fn(() => Promise.resolve({ id: `rf-${randomUUID()}` })),
    bulkTransfer: jest.fn((transfers: TransferOrder[]) =>
      Promise.resolve(
        transfers.map((transfer) => ({
          reference: transfer.reference,
          transferCode: `TRF_${transfer.reference}`,
        })),
      ),
    ),
  };
  const client = paystack as unknown as PaystackClient;
  // Redis is not part of these suites; delivery rows are covered elsewhere.
  const notification = {
    notify: jest.fn().mockResolvedValue([]),
    dispatch: jest.fn(),
  } as unknown as NotificationService;
  // No photos are uploaded, so storage is never called.
  const storage = {} as StorageService;
  const audit = new AuditService(db);
  const checkouts = new CheckoutService(db, checkoutConfig);
  const orders = new OrderService(db, checkoutConfig, audit);
  const handovers = new HandoverService(db, storage, audit, notification);
  const refunds = new RefundService(db, client, notification);
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
    notification,
  );
  const payouts = new PayoutService(db, client, audit, notification);
  const payoutRun = new PayoutRunService(db, payouts, payoutConfig);
  const disputes = new DisputeService(
    db,
    storage,
    audit,
    notification,
    refunds,
    payoutConfig,
  );
  const events = new PaystackEventsService(client, payments, refunds, payouts);
  const userIds: string[] = [];
  let buyerUser: User;
  let buyerId: string;
  let farmerUser: User;
  let farmer: Farmer;
  let agentUser: User;
  let agent: Agent;
  let admin: User;
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
        activatedAt: new Date(),
      },
    });
    userIds.push(created.id);
    return created;
  }

  function bankAccount(owner: User) {
    return db.bankAccount.create({
      data: {
        userId: owner.id,
        bankCode: '058',
        bankName: 'GTBank',
        accountNumber: '0123456789',
        accountName: `E2E ${owner.role}`,
        recipientCode: `RCP_${owner.id}`,
        setById: owner.id,
        payoutsHeldUntil: new Date(RUN_AT.getTime() - 48 * HOUR_MS),
      },
    });
  }

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    agentUser = await user(Role.EXTENSION_AGENT);
    agent = await db.agent.create({
      data: { userId: agentUser.id, isVerified: true, cluster: { create: {} } },
    });
    const cluster = await db.cluster.findUniqueOrThrow({
      where: { agentId: agent.id },
    });
    farmerUser = await user(Role.FARMER);
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
        isClustered: true,
        clusterId: cluster.id,
      },
    });
    buyerUser = await user(Role.BUYER);
    // Cart, address, checkout and order rows key on the Buyer profile.
    ({ id: buyerId } = await db.buyer.create({
      data: { userId: buyerUser.id },
    }));
    admin = await user(Role.ADMIN);
    await bankAccount(farmerUser);
    await bankAccount(agentUser);
  });

  afterAll(async () => {
    const mine = { buyerId };
    const payees = { in: [farmerUser.id, agentUser.id] };
    await db.payoutItem.deleteMany({
      where: { payout: { payeeId: payees } },
    });
    await db.payout.deleteMany({ where: { payeeId: payees } });
    await db.bankAccount.deleteMany({ where: { userId: payees } });
    // Dispute and order audit rows carry only the farm, which sets null.
    await db.auditEvent.deleteMany({
      where: {
        OR: [
          { farmId: farm.id },
          { farmerId: farmer.id },
          { agentId: agent.id },
        ],
      },
    });
    await db.refund.deleteMany({ where: { payment: { checkout: mine } } });
    await db.dispute.deleteMany({ where: { order: mine } });
    await db.payment.deleteMany({ where: { checkout: mine } });
    await db.order.deleteMany({ where: mine });
    await db.checkout.deleteMany({ where: mine });
    await db.cartItem.deleteMany({ where: mine });
    await db.address.deleteMany({ where: mine });
    await db.produce.deleteMany({ where: { farmId: farm.id } });
    // The farm restricts its cluster's delete, which cascades from the agent's user.
    await db.farm.delete({ where: { id: farm.id } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  // 4 x 1000 = 4000 items, 200 commission (5%), 200 service fee (5%) and
  // 3500 delivery: 7900 charged.
  async function paidOrder(): Promise<{ order: Order; reference: string }> {
    const listing = await db.produce.create({
      data: {
        farmId: farm.id,
        name: `E2E produce ${run}`,
        quantity: 10,
        actualQuantity: 10,
        floatingQuantity: 10,
        unit: 'kg',
        pricePerUnit: '1000.00',
        status: ProduceStatus.PUBLISHED,
      },
    });
    await db.cartItem.create({
      data: { buyerId, produceId: listing.id, quantity: 4 },
    });
    const address = await db.address.create({
      data: {
        buyerId,
        label: 'E2E',
        street: '1 Test Road',
        stateId: state.id,
        lgaId: lga.id,
      },
    });
    const checkout = await checkouts.checkout(buyerUser, randomUUID(), {
      expectedTotal: 7900,
      addressId: address.id,
      deliveryDate: addDays(lagosToday(), 2),
    });
    const payment = await payments.initiate(
      buyerUser,
      checkout.id,
      randomUUID(),
      { currency: Currency.NGN },
    );
    paystack.verifyTransaction.mockResolvedValueOnce({
      reference: payment.reference,
      status: 'success',
      amount: 790_000,
      currency: 'NGN',
      channel: 'card',
    });
    await events.handle({
      event: 'charge.success',
      data: { reference: payment.reference },
    });
    const order = await db.order.findFirstOrThrow({
      where: { checkoutId: checkout.id },
    });
    return { order, reference: payment.reference };
  }

  // The farmer prepares it, the agent hands it over, the buyer confirms it.
  async function delivered(orderId: string) {
    await orders.confirm(farmerUser, orderId);
    await orders.prepare(farmerUser, orderId);
    await orders.updateChecklist(farmerUser, orderId, {
      harvested: true,
      sorted: true,
      packaged: true,
      readyForPickup: true,
    });
    await orders.markReady(farmerUser, orderId);
    await handovers.verify(agent, orderId, {});
    await handovers.complete(agent, orderId, { recipientName: 'E2E Rider' });
    return orders.confirmReceived(buyerUser, orderId);
  }

  async function settleTransfers(orderId: string) {
    const live = await db.payout.findMany({
      where: { items: { some: { orderId } } },
    });
    for (const payout of live) {
      await events.handle({
        event: 'transfer.success',
        data: { reference: payout.id },
      });
    }
    return live;
  }

  async function paidTo(payee: User, orderId: string) {
    const { data } = await payouts.findMine(payee, { page: 1, perPage: 50 });
    return data.filter((payout) =>
      payout.items.some((item) => item.orderId === orderId),
    );
  }

  it('pays the farmer and the agent once the dispute window has passed', async () => {
    const { order } = await paidOrder();
    expect(order).toMatchObject({ status: OrderStatus.PENDING });
    expect(order.totalPrice.toFixed(2)).toBe('4000.00');
    expect(order.agentCommission.toFixed(2)).toBe('200.00');

    const fulfilled = await delivered(order.id);
    expect(fulfilled.status).toBe(OrderStatus.FULFILLED);
    await expect(payoutRun.run(RUN_AT)).resolves.toEqual({ payouts: 0 });

    await db.order.update({
      where: { id: order.id },
      data: { fulfilledAt: new Date(RUN_AT.getTime() - 25 * HOUR_MS) },
    });
    await expect(payoutRun.run(RUN_AT)).resolves.toEqual({ payouts: 2 });
    const sent = await settleTransfers(order.id);
    expect(sent).toHaveLength(2);

    const [farmerPayout] = await paidTo(farmerUser, order.id);
    const [agentPayout] = await paidTo(agentUser, order.id);
    expect(farmerPayout).toMatchObject({
      payeeRole: PayeeRole.FARMER,
      status: PayoutStatus.SUCCEEDED,
      amount: order.totalPrice.toFixed(2),
    });
    expect(agentPayout).toMatchObject({
      payeeRole: PayeeRole.AGENT,
      status: PayoutStatus.SUCCEEDED,
      amount: order.agentCommission.toFixed(2),
    });

    // Paid orders are never picked up again.
    await expect(payoutRun.run(RUN_AT)).resolves.toEqual({ payouts: 0 });
  });

  it('pays what is left after a 30% dispute refund is processed', async () => {
    const { order, reference } = await paidOrder();
    await delivered(order.id);
    const raised = await disputes.raise(
      buyerUser,
      order.id,
      { reason: 'Some of it was spoiled', quantityAffected: 1 },
      [],
    );
    await disputes.resolve(admin, raised.id, {
      refundPercent: 30,
      note: 'Partial refund',
    });

    const [refund] = await db.refund.findMany({
      where: { disputeId: raised.id },
    });
    // 30% of 4000 + 200 commission + 200 service fee.
    expect(refund).toMatchObject({ status: RefundStatus.PENDING });
    expect(refund.amount.toFixed(2)).toBe('1320.00');
    expect(paystack.createRefund).toHaveBeenLastCalledWith({
      reference,
      amount: 132_000,
    });
    // Unpaid while the refund may still fail and be re-issued.
    await expect(payoutRun.run(RUN_AT)).resolves.toEqual({ payouts: 0 });

    await events.handle({
      event: 'refund.processed',
      data: { id: refund.providerRefundId, transaction_reference: reference },
    });
    await expect(payoutRun.run(RUN_AT)).resolves.toEqual({ payouts: 2 });
    await settleTransfers(order.id);

    const [farmerPayout] = await paidTo(farmerUser, order.id);
    const [agentPayout] = await paidTo(agentUser, order.id);
    expect(farmerPayout.amount).toBe('2800.00');
    expect(agentPayout.amount).toBe('140.00');
  });

  it('lets the database refuse a second live PRODUCE item for one order', async () => {
    const { order } = await paidOrder();
    const payout = (kind: PayoutItemKind, status: PayoutStatus) =>
      db.payout.create({
        data: {
          payeeId:
            kind === PayoutItemKind.PRODUCE ? farmerUser.id : agentUser.id,
          payeeRole:
            kind === PayoutItemKind.PRODUCE
              ? PayeeRole.FARMER
              : PayeeRole.AGENT,
          amount: '1.00',
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'E2E',
          recipientCode: 'RCP_e2e',
          status,
          items: {
            create: [{ kind, orderId: order.id, amount: '1.00', status }],
          },
        },
      });
    await payout(PayoutItemKind.PRODUCE, PayoutStatus.FAILED);
    await payout(PayoutItemKind.PRODUCE, PayoutStatus.PENDING);
    // The commission is a separate kind, so it can be live alongside.
    await payout(PayoutItemKind.COMMISSION, PayoutStatus.PENDING);
    await expect(
      payout(PayoutItemKind.PRODUCE, PayoutStatus.SUCCEEDED),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
