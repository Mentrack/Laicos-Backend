import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  CheckoutStatus,
  FarmVerificationStatus,
  OrderStatus,
  PackagingType,
  ProduceCondition,
  ProduceStatus,
  QualityGrade,
  Role,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type Agent,
  type Buyer,
  type Farm,
  type Lga,
  type State,
  type User,
} from '../generated/client';
import { AuditService } from '../src/audit/audit.service';
import { advisoryLock } from '../src/common/advisory-lock';
import { addDays, lagosToday, toDateColumn } from '../src/common/dates';
import { LocationService } from '../src/location/location.service';
import type { NotificationQueue } from '../src/notifications/notification-queue';
import { NotificationService } from '../src/notifications/notification.service';
import { CheckoutExpiryService } from '../src/payment/checkout-expiry.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminSourcingRequestService } from '../src/sourcing-request/admin-sourcing-request.service';
import { SourcingConfig } from '../src/sourcing-request/sourcing-config';
import { SourcingContractService } from '../src/sourcing-request/sourcing-contract.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Every row is tagged with this run's id and removed
// in afterAll.
const run = randomUUID().slice(0, 8);

describe('Sourcing contract signing (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const queue = { enqueue: jest.fn() } as unknown as NotificationQueue;
  const notifications = new NotificationService(db, queue);
  const audit = new AuditService(db);
  const service = new SourcingContractService(
    db,
    testCheckoutConfig({
      SERVICE_FEE_PERCENT: '5',
      AGENT_COMMISSION_PERCENT: '10',
    }),
    new SourcingConfig(
      new ConfigService({
        SOURCING_RESPONSE_HOURS: '24',
        SOURCING_CHECKOUT_HOLD_HOURS: '48',
      }),
    ),
    notifications,
    audit,
    new LocationService(db),
  );
  const expiry = new CheckoutExpiryService(db);
  const adminRequests = new AdminSourcingRequestService(
    db,
    audit,
    notifications,
  );
  const requestIds: string[] = [];
  let users: User[];
  let admin: User;
  let state: State;
  let lga: Lga;
  let farms: Farm[];
  let buyer: Buyer & { user: User };
  let agent: Agent & { user: User };

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

  // The farmer's own, marketplace listing: sourcing must never touch it.
  function realListing(farm: Farm) {
    return db.produce.create({
      data: {
        farmId: farm.id,
        name: `E2E maize ${run}`,
        quantity: 10,
        actualQuantity: 10,
        floatingQuantity: 10,
        unit: 'bags',
        pricePerUnit: '800.00',
        status: ProduceStatus.PUBLISHED,
      },
    });
  }

  // A CONFIRMED request with two priced, accepted offers to two farms
  // (4×1200 + 6×1000) and a live contract at the suggested price of 12420.00.
  async function confirmedRequest() {
    const request = await db.sourcingRequest.create({
      data: {
        buyerId: buyer.id,
        produceName: `E2E white maize ${run}`,
        quantity: 10,
        unit: SourcingUnit.BAGS,
        quality: QualityGrade.GRADE_A,
        packaging: PackagingType.BAGS,
        condition: ProduceCondition.FRESH,
        deliveryDestination: 'Kano',
        requiredDate: toDateColumn(addDays(lagosToday(), 10)),
        status: SourcingRequestStatus.CONFIRMED,
        assignedAgentId: agent.id,
        assignedAt: new Date(),
        agreedPrice: '12420.00',
        deliveryCountry: 'Nigeria',
        deliveryAddress: '12 Bompai Road',
        deliveryStateId: state.id,
        deliveryLgaId: lga.id,
        deliveryFrom: toDateColumn(addDays(lagosToday(), 2)),
        deliveryTo: toDateColumn(addDays(lagosToday(), 5)),
        allocations: {
          create: [
            {
              farmId: farms[0].id,
              quantity: 4,
              unit: SourcingUnit.BAGS,
              status: SourcingOfferStatus.ACCEPTED,
              agreedUnitPrice: '1200.00',
            },
            {
              farmId: farms[1].id,
              quantity: 6,
              unit: SourcingUnit.BAGS,
              status: SourcingOfferStatus.ACCEPTED,
              agreedUnitPrice: '1000.00',
            },
          ],
        },
        contracts: {
          create: { agreedPrice: '12420.00', terms: { e2e: run } },
        },
      },
    });
    requestIds.push(request.id);
    return request;
  }

  async function signedRequest() {
    const request = await confirmedRequest();
    await service.sign(request.id, asBuyer(), randomUUID());
    const { checkoutId } = await service.sign(
      request.id,
      asAgent(),
      randomUUID(),
    );
    if (checkoutId === null) {
      throw new Error('The second signature placed no checkout');
    }
    return { request, checkoutId };
  }

  function hiddenListings(requestId: string) {
    return db.produce.findMany({
      where: {
        sourcingAllocations: { some: { sourcingRequestId: requestId } },
      },
      orderBy: { quantity: 'asc' },
    });
  }

  async function holdRequest(requestId: string) {
    let open!: () => void;
    let held!: () => void;
    const closed = new Promise<void>((resolve) => (open = resolve));
    const ready = new Promise<void>((resolve) => (held = resolve));
    const holder = db.$transaction(
      async (tx) => {
        await advisoryLock(tx, `sourcing:${requestId}`);
        await tx.$queryRaw`SELECT id FROM "SourcingContract" WHERE "sourcingRequestId" = ${requestId} FOR UPDATE`;
        held();
        await closed;
      },
      { timeout: 30_000 },
    );
    await ready;
    return {
      release: async () => {
        open();
        await holder;
      },
    };
  }

  // Polls until `count` backends are queued behind a lock.
  async function waitForBlocked(count: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await db.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
      if (waiting >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Fewer than ${count} backends ever waited on a lock`);
  }

  const asBuyer = () => ({ role: 'BUYER' as const, userId: buyer.userId });
  const asAgent = () => ({ role: 'AGENT' as const, userId: agent.userId });

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    const [farmerUser, buyerUser, agentUser, adminUser] = [
      await user(Role.FARMER),
      await user(Role.BUYER),
      await user(Role.EXTENSION_AGENT),
      await user(Role.ADMIN),
    ];
    users = [farmerUser, buyerUser, agentUser, adminUser];
    admin = adminUser;
    const farmer = await db.farmer.create({ data: { userId: farmerUser.id } });
    farms = [];
    for (const name of ['A', 'B']) {
      farms.push(
        await db.farm.create({
          data: {
            ownerId: farmer.id,
            name: `E2E Farm ${name} ${run}`,
            stateId: state.id,
            lgaId: lga.id,
            location: '1 Test Road',
            size: 1,
            mainProduce: 'Maize',
            verificationStatus: FarmVerificationStatus.VERIFIED,
          },
        }),
      );
    }
    buyer = await db.buyer.create({
      data: { userId: buyerUser.id },
      include: { user: true },
    });
    agent = await db.agent.create({
      data: { userId: agentUser.id, isVerified: true },
      include: { user: true },
    });
  });

  afterAll(async () => {
    // Orders, checkouts, contracts and requests restrict deletes, so they go
    // first; offers and audit rows cascade with their request, and offers
    // restrict deleting their farm and hidden listing.
    const farmIds = farms.map((f) => f.id);
    await db.order.deleteMany({ where: { buyerId: buyer.id } });
    await db.checkout.deleteMany({ where: { buyerId: buyer.id } });
    await db.sourcingContract.deleteMany({
      where: { sourcingRequestId: { in: requestIds } },
    });
    await db.sourcingRequest.deleteMany({ where: { id: { in: requestIds } } });
    await db.produce.deleteMany({ where: { farmId: { in: farmIds } } });
    await db.farm.deleteMany({ where: { id: { in: farmIds } } });
    await db.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  it('places exactly one checkout when buyer and agent sign at once', async () => {
    const request = await confirmedRequest();

    // Both calls start while a gate holds the request's lock and the contract
    // row, so they really overlap: without the service's own lock both would
    // read an unsigned contract and neither would place the checkout.
    const gate = await holdRequest(request.id);
    const signing = Promise.all([
      service.sign(request.id, asBuyer(), randomUUID()),
      service.sign(request.id, asAgent(), randomUUID()),
    ]);
    await waitForBlocked(2);
    await gate.release();
    const [byBuyer, byAgent] = await signing;

    const checkouts = await db.checkout.findMany({
      where: { sourcingRequestId: request.id },
      include: { orders: true },
    });
    expect(checkouts).toHaveLength(1);
    const [checkout] = checkouts;
    expect(checkout.totalPrice.toFixed(2)).toBe('12420.00');
    expect(checkout.orders.map((o) => o.commissionAgentId)).toEqual([
      agent.id,
      agent.id,
    ]);
    // Whichever call landed second saw the first's signature and placed it.
    expect([byBuyer.checkoutId, byAgent.checkoutId].sort()).toEqual(
      [checkout.id, null].sort(),
    );
    const contract = await db.sourcingContract.findFirstOrThrow({
      where: { sourcingRequestId: request.id },
    });
    expect(contract.buyerSignedAt).not.toBeNull();
    expect(contract.agentSignedAt).not.toBeNull();
    await expect(hiddenListings(request.id)).resolves.toHaveLength(2);
  });

  it('backs each sourced order with a hidden SOURCED listing per offer, already held', async () => {
    const real = await realListing(farms[0]);

    const { request, checkoutId } = await signedRequest();

    const offers = await db.sourcingAllocation.findMany({
      where: { sourcingRequestId: request.id },
      orderBy: { quantity: 'asc' },
    });
    const listings = await hiddenListings(request.id);
    expect(offers.map((o) => o.produceId)).toEqual(listings.map((l) => l.id));
    expect(
      listings.map((l) => ({
        farmId: l.farmId,
        name: l.name,
        unit: l.unit,
        status: l.status,
        quantity: l.quantity,
        actualQuantity: l.actualQuantity,
        floatingQuantity: l.floatingQuantity,
        pricePerUnit: l.pricePerUnit.toFixed(2),
      })),
    ).toEqual([
      {
        farmId: farms[0].id,
        name: request.produceName,
        unit: 'bags',
        status: ProduceStatus.SOURCED,
        quantity: 4,
        actualQuantity: 4,
        floatingQuantity: 0,
        pricePerUnit: '1200.00',
      },
      {
        farmId: farms[1].id,
        name: request.produceName,
        unit: 'bags',
        status: ProduceStatus.SOURCED,
        quantity: 6,
        actualQuantity: 6,
        floatingQuantity: 0,
        pricePerUnit: '1000.00',
      },
    ]);
    const orders = await db.order.findMany({
      where: { checkoutId },
      orderBy: { quantity: 'asc' },
    });
    expect(
      orders.map((o) => [o.produceId, o.sourced, o.totalPrice.toFixed(2)]),
    ).toEqual([
      [listings[0].id, true, '4800.00'],
      [listings[1].id, true, '6000.00'],
    ]);
    await expect(
      db.produce.findUniqueOrThrow({ where: { id: real.id } }),
    ).resolves.toMatchObject({
      quantity: 10,
      actualQuantity: 10,
      floatingQuantity: 10,
      status: ProduceStatus.PUBLISHED,
    });
  });

  it('a lapsed sourced checkout returns stock to the hidden listings only', async () => {
    const real = await realListing(farms[0]);
    const { request, checkoutId } = await signedRequest();
    // Pinned far in the past with a matching `now`, so the sweep only reaches
    // this checkout and never other rows in the local database.
    await db.checkout.update({
      where: { id: checkoutId },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    });

    await expect(
      expiry.expireOverdue(new Date('2000-01-01T01:00:00.000Z')),
    ).resolves.toBe(1);

    await expect(
      db.checkout.findUniqueOrThrow({ where: { id: checkoutId } }),
    ).resolves.toMatchObject({ status: CheckoutStatus.EXPIRED });
    await expect(
      db.sourcingRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: SourcingRequestStatus.NEGOTIATING });
    const listings = await hiddenListings(request.id);
    expect(
      listings.map((l) => [l.status, l.floatingQuantity, l.quantity]),
    ).toEqual([
      [ProduceStatus.SOURCED, 4, 4],
      [ProduceStatus.SOURCED, 6, 6],
    ]);
    await expect(
      db.produce.findUniqueOrThrow({ where: { id: real.id } }),
    ).resolves.toMatchObject({ actualQuantity: 10, floatingQuantity: 10 });
  });

  it('an admin close cancels the sourced orders and returns stock to the hidden listings only', async () => {
    const real = await realListing(farms[1]);
    const { request, checkoutId } = await signedRequest();

    await adminRequests.close(admin, request.id, { reason: 'Buyer withdrew' });

    await expect(
      db.order.findMany({ where: { checkoutId }, select: { status: true } }),
    ).resolves.toEqual([
      { status: OrderStatus.CANCELLED },
      { status: OrderStatus.CANCELLED },
    ]);
    const listings = await hiddenListings(request.id);
    expect(listings.map((l) => [l.floatingQuantity, l.quantity])).toEqual([
      [4, 4],
      [6, 6],
    ]);
    await expect(
      db.produce.findUniqueOrThrow({ where: { id: real.id } }),
    ).resolves.toMatchObject({ actualQuantity: 10, floatingQuantity: 10 });
  });
});
