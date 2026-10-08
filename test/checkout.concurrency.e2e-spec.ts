import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  FarmVerificationStatus,
  ProduceStatus,
  Role,
  type Farm,
  type Lga,
  type State,
  type User,
} from '../generated/client';
import { CheckoutService } from '../src/cart/checkout.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Runs against the docker compose Postgres. Every row is tagged with this
// run's id and removed in afterAll.
const run = randomUUID().slice(0, 8);

describe('Checkout concurrency (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const service = new CheckoutService(db);
  const buyerIds: string[] = [];
  let farmerUser: User;
  let state: State;
  let lga: Lga;
  let farm: Farm;

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

  function addToCart(buyerId: string, produceId: string, quantity: number) {
    return db.cartItem.create({ data: { buyerId, produceId, quantity } });
  }

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    farmerUser = await user(Role.FARMER);
    const farmer = await db.farmer.create({
      data: { userId: farmerUser.id },
    });
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
    // Orders and checkouts restrict deletes, so they go first.
    await db.order.deleteMany({ where: { buyerId: { in: buyerIds } } });
    await db.checkout.deleteMany({ where: { buyerId: { in: buyerIds } } });
    await db.cartItem.deleteMany({ where: { buyerId: { in: buyerIds } } });
    await db.farm.delete({ where: { id: farm.id } });
    await db.user.deleteMany({
      where: { id: { in: [...buyerIds, farmerUser.id] } },
    });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  it('lets exactly one of two buyers take the last units', async () => {
    const listing = await produce(10);
    const [a, b] = await Promise.all([buyer(), buyer()]);
    await addToCart(a.id, listing.id, 10);
    await addToCart(b.id, listing.id, 10);

    const results = await Promise.allSettled([
      service.checkout(a, randomUUID(), { expectedTotal: 1000 }),
      service.checkout(b, randomUUID(), { expectedTotal: 1000 }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // The loser is told which item to fix, not given a deadlock or timeout.
    const [lost] = results.filter((r) => r.status === 'rejected');
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect((lost.reason as ConflictException).getResponse()).toMatchObject({
      code: 'CART_NEEDS_ATTENTION',
    });
    const after = await db.produce.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(after.floatingQuantity).toBe(0);
    expect(after.status).toBe(ProduceStatus.SOLD_OUT);
  });

  it('creates one checkout when the same request arrives twice at once', async () => {
    const listing = await produce(10);
    const a = await buyer();
    await addToCart(a.id, listing.id, 5);
    const key = randomUUID();

    const [first, second] = await Promise.all([
      service.checkout(a, key, { expectedTotal: 500 }),
      service.checkout(a, key, { expectedTotal: 500 }),
    ]);

    expect(second.id).toBe(first.id);
    await expect(db.checkout.count({ where: { buyerId: a.id } })).resolves.toBe(
      1,
    );
    const after = await db.produce.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(after.floatingQuantity).toBe(5);
  });

  it('checks out overlapping carts added in opposite order without deadlock', async () => {
    const [x, y] = [await produce(10), await produce(10)];
    const [a, b] = await Promise.all([buyer(), buyer()]);
    await addToCart(a.id, x.id, 1);
    await addToCart(a.id, y.id, 1);
    await addToCart(b.id, y.id, 1);
    await addToCart(b.id, x.id, 1);

    const results = await Promise.allSettled([
      service.checkout(a, randomUUID(), { expectedTotal: 200 }),
      service.checkout(b, randomUUID(), { expectedTotal: 200 }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const stock = await db.produce.findMany({
      where: { id: { in: [x.id, y.id] } },
      select: { floatingQuantity: true },
    });
    expect(stock.map((s) => s.floatingQuantity)).toEqual([8, 8]);
  });
});
