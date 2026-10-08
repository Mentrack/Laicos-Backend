import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutService } from '../checkout.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';
const checkoutId = 'c0ffee00-1b3f-4e5d-8a6b-7c8d9e0f1a2b';

function listing(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    farmId: 'farm-1',
    name: `Produce ${id}`,
    unit: 'kg',
    imageUrl: null,
    pricePerUnit: new Prisma.Decimal('350.50'),
    floatingQuantity: 100,
    status: ProduceStatus.PUBLISHED,
    type: ProduceType.LOCAL,
    farm: {
      id: 'farm-1',
      farmCode: 'LF-000123',
      verificationStatus: FarmVerificationStatus.VERIFIED,
    },
    ...overrides,
  };
}

function cartRow(produceId: string, quantity: number, overrides = {}) {
  return {
    id: `item-${produceId}`,
    buyerId: buyer.id,
    produceId,
    quantity,
    produce: listing(produceId, overrides),
  };
}

describe('CheckoutService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    checkout: { findUnique: jest.fn(), create: jest.fn() },
    cartItem: { findMany: jest.fn(), deleteMany: jest.fn() },
    produce: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  let transactionOptions: unknown;
  const database = {
    checkout: { findFirst: jest.fn() },
    $transaction: (
      callback: (client: typeof tx) => Promise<unknown>,
      options?: unknown,
    ) => {
      transactionOptions = options;
      return callback(tx);
    },
  };
  const service = new CheckoutService(database as unknown as PrismaService);

  // Reservation succeeds and returns the listing as the locked row.
  function reservable(...rows: ReturnType<typeof cartRow>[]) {
    tx.cartItem.findMany.mockResolvedValue(rows);
    tx.produce.updateMany.mockResolvedValue({ count: 1 });
    for (const row of rows) {
      tx.produce.findUnique.mockResolvedValueOnce(row.produce);
    }
    tx.checkout.create.mockResolvedValue({ id: checkoutId, orders: [] });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    tx.checkout.findUnique.mockResolvedValue(null);
  });

  it('locks the cart, then replays an earlier checkout with the same key', async () => {
    const earlier = { id: checkoutId, orders: [] };
    tx.checkout.findUnique.mockResolvedValue(earlier);
    await expect(
      service.checkout(buyer, key, { expectedTotal: 1 }),
    ).resolves.toBe(earlier);
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      `cart:${buyer.id}`,
    );
    expect(tx.checkout.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buyerId_idempotencyKey: { buyerId: buyer.id, idempotencyKey: key },
        },
      }),
    );
    // A refilled cart is left alone by a replay.
    expect(tx.cartItem.findMany).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses an empty cart', async () => {
    tx.cartItem.findMany.mockResolvedValue([]);
    await expect(
      service.checkout(buyer, key, { expectedTotal: 0 }),
    ).rejects.toThrow(new BadRequestException('Your cart is empty'));
  });

  it('lists every problem item at once and reserves nothing', async () => {
    tx.cartItem.findMany.mockResolvedValue([
      cartRow('a', 10, {
        name: 'Yellow Maize',
        unit: 'Ton',
        floatingQuantity: 8,
      }),
      cartRow('b', 1, {
        name: 'Sesame Seeds',
        status: ProduceStatus.SOLD_OUT,
      }),
      cartRow('c', 1),
    ]);
    const error: unknown = await service
      .checkout(buyer, key, { expectedTotal: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      message: [
        'Yellow Maize: only 8 Ton available',
        'Sesame Seeds: no longer available',
      ],
      code: 'CART_NEEDS_ATTENTION',
    });
    expect(tx.produce.updateMany).not.toHaveBeenCalled();
  });

  it('reads the cart in produceId order so reservations never deadlock', async () => {
    reservable(cartRow('a', 1), cartRow('b', 1));
    await service.checkout(buyer, key, { expectedTotal: 701 });
    expect(tx.cartItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buyerId: buyer.id },
        orderBy: { produceId: 'asc' },
      }),
    );
    const reservedIds = (
      tx.produce.updateMany.mock.calls as [{ where: { id: string } }][]
    ).map(([args]) => args.where.id);
    expect(reservedIds).toEqual(['a', 'b']);
  });

  it('matches a whole-number expectedTotal against the 2-dp total', async () => {
    reservable(cartRow('a', 3)); // 3 × 350.50 = 1051.50
    await expect(
      service.checkout(buyer, key, { expectedTotal: 1051.5 }),
    ).resolves.toBeDefined();
  });

  it('rolls back when prices moved since the buyer saw the cart', async () => {
    reservable(cartRow('a', 3));
    const error: unknown = await service
      .checkout(buyer, key, { expectedTotal: 1000 })
      .catch((caught: unknown) => caught);
    expect((error as ConflictException).getResponse()).toEqual({
      message: 'Prices in your cart have changed',
      code: 'CART_PRICE_CHANGED',
    });
    expect(tx.checkout.create).not.toHaveBeenCalled();
  });

  async function attentionError(expectedTotal: number) {
    const error: unknown = await service
      .checkout(buyer, key, { expectedTotal })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse();
  }

  it('names the item when another buyer took the stock mid-checkout', async () => {
    tx.cartItem.findMany.mockResolvedValue([cartRow('a', 5)]);
    tx.produce.updateMany.mockResolvedValue({ count: 0 });
    tx.produce.findUnique.mockResolvedValue(
      listing('a', { floatingQuantity: 2 }),
    );
    await expect(attentionError(1752.5)).resolves.toEqual({
      message: ['Produce a: only 2 kg available'],
      code: 'CART_NEEDS_ATTENTION',
    });
    expect(tx.checkout.create).not.toHaveBeenCalled();
  });

  it('reports a listing hidden mid-checkout as unavailable, not 404', async () => {
    tx.cartItem.findMany.mockResolvedValue([cartRow('a', 5)]);
    tx.produce.updateMany.mockResolvedValue({ count: 0 });
    tx.produce.findUnique.mockResolvedValue(
      listing('a', {
        farm: { verificationStatus: FarmVerificationStatus.PENDING },
      }),
    );
    await expect(attentionError(1752.5)).resolves.toEqual({
      message: ['Produce a: no longer available'],
      code: 'CART_NEEDS_ATTENTION',
    });
  });

  it('reports a listing deleted mid-checkout as unavailable', async () => {
    tx.cartItem.findMany.mockResolvedValue([cartRow('a', 5)]);
    tx.produce.updateMany.mockResolvedValue({ count: 0 });
    tx.produce.findUnique.mockResolvedValue(null);
    await expect(attentionError(1752.5)).resolves.toEqual({
      message: ['Produce a: no longer available'],
      code: 'CART_NEEDS_ATTENTION',
    });
  });

  it('gives checkout a longer transaction budget than the 5s default', async () => {
    reservable(cartRow('a', 1));
    await service.checkout(buyer, key, { expectedTotal: 350.5 });
    expect(transactionOptions).toEqual({ timeout: 15_000, maxWait: 5_000 });
  });

  it('creates the checkout with one order per item, then empties the cart', async () => {
    reservable(cartRow('a', 1), cartRow('b', 2));
    await service.checkout(buyer, key, { expectedTotal: 1051.5 });
    expect(tx.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          buyerId: buyer.id,
          idempotencyKey: key,
          totalPrice: new Prisma.Decimal('1051.50'),
          orders: {
            create: [
              expect.objectContaining({
                produceId: 'a',
                quantity: 1,
                buyerId: buyer.id,
              }),
              expect.objectContaining({
                produceId: 'b',
                quantity: 2,
                buyerId: buyer.id,
              }),
            ],
          },
        },
      }),
    );
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { buyerId: buyer.id },
    });
  });

  describe('findOne', () => {
    it('scopes a buyer to their own checkouts', async () => {
      database.checkout.findFirst.mockResolvedValue({ id: checkoutId });
      await service.findOne(buyer, checkoutId);
      expect(database.checkout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: checkoutId, buyerId: buyer.id },
        }),
      );
    });

    it('lets an admin see any checkout', async () => {
      database.checkout.findFirst.mockResolvedValue({ id: checkoutId });
      await service.findOne(admin, checkoutId);
      expect(database.checkout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: checkoutId } }),
      );
    });

    it('404s on a checkout the caller cannot see', async () => {
      database.checkout.findFirst.mockResolvedValue(null);
      await expect(service.findOne(buyer, checkoutId)).rejects.toThrow(
        new NotFoundException('Checkout not found'),
      );
    });
  });
});
