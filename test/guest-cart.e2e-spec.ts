import 'dotenv/config';
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
import { CartService } from '../src/cart/cart.service';
import { testCheckoutConfig } from '../src/payment/tests/checkout-config.fixture';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProduceService } from '../src/produce/produce.service';
import type { StorageService } from '../src/storage/storage.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Rows are tagged with this run's id and removed in
// afterAll.
const run = randomUUID().slice(0, 8);

describe('Guest browsing and cart (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const cart = new CartService(db, testCheckoutConfig());
  // Reads never touch storage.
  const produceService = new ProduceService(db, {} as StorageService);
  const users: User[] = [];
  let state: State;
  let lga: Lga;
  let verified: Farm;
  let unverified: Farm;

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
    users.push(created);
    return created;
  }

  async function farm(verificationStatus: FarmVerificationStatus) {
    const owner = await user(Role.FARMER);
    const farmer = await db.farmer.create({ data: { userId: owner.id } });
    return db.farm.create({
      data: {
        ownerId: farmer.id,
        name: `E2E Farm ${run}`,
        stateId: state.id,
        lgaId: lga.id,
        location: '1 Test Road',
        size: 1,
        mainProduce: 'Maize',
        verificationStatus,
      },
    });
  }

  function listing(
    farmId: string,
    stock: number,
    status: ProduceStatus = ProduceStatus.PUBLISHED,
  ) {
    return db.produce.create({
      data: {
        farmId,
        name: `E2E guest ${run}`,
        quantity: stock,
        actualQuantity: stock,
        floatingQuantity: stock,
        unit: 'kg',
        pricePerUnit: '100.00',
        status,
      },
    });
  }

  beforeAll(async () => {
    await db.$connect();
    state = await db.state.create({ data: { name: `E2E State ${run}` } });
    lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    verified = await farm(FarmVerificationStatus.VERIFIED);
    unverified = await farm(FarmVerificationStatus.PENDING);
  });

  afterAll(async () => {
    const ids = users.map((u) => u.id);
    await db.cartItem.deleteMany({ where: { buyerId: { in: ids } } });
    await db.cartMerge.deleteMany({ where: { buyerId: { in: ids } } });
    await db.produce.deleteMany({
      where: { farmId: { in: [verified.id, unverified.id] } },
    });
    await db.farm.deleteMany({
      where: { id: { in: [verified.id, unverified.id] } },
    });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.lga.delete({ where: { id: lga.id } });
    await db.state.delete({ where: { id: state.id } });
    await db.$disconnect();
  });

  it('shows a guest only published listings on verified farms', async () => {
    const shown = await listing(verified.id, 10);
    const draft = await listing(verified.id, 10, ProduceStatus.DRAFT);
    const hidden = await listing(unverified.id, 10);
    const { data } = await produceService.findAll(null, {
      search: `E2E guest ${run}`,
      perPage: 50,
    });
    const ids = data.map((p) => p.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('quotes a device cart, then merges it into a buyer cart that already has items', async () => {
    const a = await listing(verified.id, 10);
    const b = await listing(verified.id, 3);
    const hidden = await listing(unverified.id, 10);

    const quote = await cart.quote({
      items: [
        { produceId: a.id, quantity: 2 },
        { produceId: b.id, quantity: 5 },
        { produceId: hidden.id, quantity: 1 },
      ],
    });
    expect(quote.items.map((line) => line.issue)).toEqual([
      null,
      'INSUFFICIENT_STOCK',
    ]);
    expect(quote.unavailableProduceIds).toEqual([hidden.id]);
    expect(quote.total).toBe('200.00');

    const buyer = await user(Role.BUYER);
    await db.cartItem.create({
      data: { buyerId: buyer.id, produceId: a.id, quantity: 3 },
    });
    const key = randomUUID();
    const deviceCart = {
      items: [
        { produceId: a.id, quantity: 2 },
        { produceId: b.id, quantity: 5 },
      ],
    };
    const merged = await cart.mergeItems(buyer, key, deviceCart);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ quantity: 5 });
    expect(merged.skipped).toEqual([
      expect.objectContaining({ produceId: b.id, code: 'INSUFFICIENT_STOCK' }),
    ]);

    // A retry after a lost response: same key, nothing added, same report.
    const retried = await cart.mergeItems(buyer, key, deviceCart);
    expect(retried.items[0]).toMatchObject({ quantity: 5 });
    expect(retried.skipped).toEqual(merged.skipped);
  });
});
