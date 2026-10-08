import { ConflictException, HttpException } from '@nestjs/common';
import {
  CheckoutStatus,
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { addDays, lagosToday } from '../../common/dates';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
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

function checkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: checkoutId,
    checkoutNumber: 'CHK-000001',
    buyerId: buyer.id,
    idempotencyKey: key,
    status: CheckoutStatus.AWAITING_PAYMENT,
    subtotal: new Prisma.Decimal('701.00'),
    deliveryFee: new Prisma.Decimal('3500.00'),
    totalPrice: new Prisma.Decimal('4201.00'),
    expiresAt: new Date(),
    paidAt: null,
    deliveryDate: new Date('2026-10-10T00:00:00.000Z'),
    deliveryLabel: 'Warehouse A',
    deliveryStreet: '1 Road',
    deliveryState: 'Kano',
    deliveryLga: 'Nassarawa',
    deliveryContactName: null,
    deliveryContactPhone: null,
    createdAt: new Date(),
    orders: [],
    payments: [],
    ...overrides,
  };
}

// Computed from today so the date never falls out of the delivery window.
function body(expectedTotal: number) {
  return {
    expectedTotal,
    addressId: 'address-1',
    deliveryDate: addDays(lagosToday(), 2),
  };
}

// The body HttpExceptionFilter reads `message` and `code` from.
async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('CheckoutService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    checkout: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    order: { findMany: jest.fn(), updateMany: jest.fn() },
    payment: { updateMany: jest.fn() },
    address: { findFirst: jest.fn() },
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
  const service = new CheckoutService(
    database as unknown as PrismaService,
    testCheckoutConfig(),
  );

  // Reservation succeeds and returns the listing as the locked row.
  function reservable(...rows: ReturnType<typeof cartRow>[]) {
    tx.cartItem.findMany.mockResolvedValue(rows);
    tx.produce.updateMany.mockResolvedValue({ count: 1 });
    for (const row of rows) {
      tx.produce.findUnique.mockResolvedValueOnce(row.produce);
    }
    tx.checkout.create.mockResolvedValue(checkoutRow());
  }

  beforeEach(() => {
    jest.resetAllMocks();
    tx.address.findFirst.mockResolvedValue({
      id: 'address-1',
      label: 'Warehouse A',
      street: '1 Road',
      contactName: null,
      contactPhone: null,
      state: { name: 'Kano' },
      lga: { name: 'Nassarawa' },
    });
    tx.checkout.findUnique.mockResolvedValue(null);
  });

  it('locks the cart, then replays an earlier checkout with the same key', async () => {
    tx.checkout.findUnique.mockResolvedValue(checkoutRow());
    await expect(
      service.checkout(buyer, key, body(1 + 3500)),
    ).resolves.toMatchObject({
      id: checkoutId,
      status: 'AWAITING_PAYMENT',
      shippingTo: { label: 'Warehouse A' },
    });
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
      errorBody(service.checkout(buyer, key, body(3500))),
    ).resolves.toEqual({ message: 'Your cart is empty', code: 'CART_EMPTY' });
  });

  it('matches a whole-number expectedTotal against a 2-dp total', async () => {
    reservable(
      cartRow('a', 2, { pricePerUnit: new Prisma.Decimal('4500.00') }),
    );
    await expect(
      service.checkout(buyer, key, body(9000 + 3500)),
    ).resolves.toBeDefined();
  });

  it('asks the buyer to retry when the checkout transaction times out', async () => {
    tx.cartItem.findMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
        code: 'P2028',
        clientVersion: 'test',
      }),
    );
    const response = await errorBody(
      service.checkout(buyer, key, body(1 + 3500)),
    );
    expect(response).toEqual({
      message: 'Checkout is busy; please try again',
      code: 'CHECKOUT_BUSY',
    });
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
      .checkout(buyer, key, body(1 + 3500))
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
    await service.checkout(buyer, key, body(701 + 3500));
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
      service.checkout(buyer, key, body(1051.5 + 3500)),
    ).resolves.toBeDefined();
  });

  it('rolls back when prices moved since the buyer saw the cart', async () => {
    reservable(cartRow('a', 3));
    const error: unknown = await service
      .checkout(buyer, key, body(1000 + 3500))
      .catch((caught: unknown) => caught);
    expect((error as ConflictException).getResponse()).toEqual({
      message: 'Prices in your cart have changed',
      code: 'CART_PRICE_CHANGED',
    });
    expect(tx.checkout.create).not.toHaveBeenCalled();
  });

  async function attentionError(expectedTotal: number) {
    const error: unknown = await service
      .checkout(buyer, key, body(expectedTotal + 3500))
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
    await service.checkout(buyer, key, body(350.5 + 3500));
    expect(transactionOptions).toEqual({ timeout: 15_000, maxWait: 5_000 });
  });

  it('creates the checkout with one order per item, then empties the cart', async () => {
    reservable(cartRow('a', 1), cartRow('b', 2));
    await service.checkout(buyer, key, body(1051.5 + 3500));
    expect(tx.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerId: buyer.id,
          idempotencyKey: key,
          subtotal: new Prisma.Decimal('1051.50'),
          deliveryFee: new Prisma.Decimal('3500.00'),
          totalPrice: new Prisma.Decimal('4551.50'),
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
        }) as unknown,
      }),
    );
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { buyerId: buyer.id },
    });
  });

  it('reports problem items before checking the address', async () => {
    tx.cartItem.findMany.mockResolvedValue([
      cartRow('a', 1, { status: ProduceStatus.SOLD_OUT }),
    ]);
    await expect(
      errorBody(service.checkout(buyer, key, body(3500))),
    ).resolves.toMatchObject({ code: 'CART_NEEDS_ATTENTION' });
    expect(tx.address.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unknown address before reserving anything', async () => {
    tx.cartItem.findMany.mockResolvedValue([cartRow('a', 1)]);
    tx.address.findFirst.mockResolvedValue(null);
    await expect(
      errorBody(service.checkout(buyer, key, body(3850.5))),
    ).resolves.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
    expect(tx.produce.updateMany).not.toHaveBeenCalled();
  });

  it('places the orders awaiting payment', async () => {
    reservable(cartRow('a', 2));
    await service.checkout(buyer, key, body(701 + 3500));
    expect(tx.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CheckoutStatus.AWAITING_PAYMENT,
          deliveryLabel: 'Warehouse A',
        }) as unknown,
      }),
    );
    expect(tx.cartItem.deleteMany).toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('scopes a buyer to their own checkouts', async () => {
      database.checkout.findFirst.mockResolvedValue(checkoutRow());
      await service.findOne(buyer, checkoutId);
      expect(database.checkout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: checkoutId, buyerId: buyer.id },
        }),
      );
    });

    it('lets an admin see any checkout', async () => {
      database.checkout.findFirst.mockResolvedValue(checkoutRow());
      await service.findOne(admin, checkoutId);
      expect(database.checkout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: checkoutId } }),
      );
    });

    it('404s on a checkout the caller cannot see', async () => {
      database.checkout.findFirst.mockResolvedValue(null);
      await expect(
        errorBody(service.findOne(buyer, checkoutId)),
      ).resolves.toEqual({
        message: 'Checkout not found',
        code: 'CHECKOUT_NOT_FOUND',
      });
    });
  });

  describe('cancel', () => {
    it('releases an unpaid checkout under its lock', async () => {
      tx.checkout.findFirst.mockResolvedValue(checkoutRow());
      tx.order.findMany.mockResolvedValue([]);
      tx.checkout.update.mockResolvedValue(
        checkoutRow({ status: CheckoutStatus.CANCELLED }),
      );
      await expect(service.cancel(buyer, checkoutId)).resolves.toMatchObject({
        status: CheckoutStatus.CANCELLED,
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `checkout:${checkoutId}`,
      );
      expect(tx.checkout.findFirst).toHaveBeenCalledWith({
        where: { id: checkoutId, buyerId: buyer.id },
      });
      expect(tx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancellationReason: 'Cancelled by buyer',
          }) as unknown,
        }),
      );
      expect(transactionOptions).toEqual({ timeout: 15_000, maxWait: 5_000 });
    });

    it('asks the buyer to retry when the transaction times out', async () => {
      tx.checkout.findFirst.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
          code: 'P2028',
          clientVersion: 'test',
        }),
      );
      await expect(
        errorBody(service.cancel(buyer, checkoutId)),
      ).resolves.toEqual({
        message: 'Checkout is busy; please try again',
        code: 'CHECKOUT_BUSY',
      });
    });

    it.each([
      CheckoutStatus.PAID,
      CheckoutStatus.EXPIRED,
      CheckoutStatus.CANCELLED,
    ])('refuses a %s checkout', async (status) => {
      tx.checkout.findFirst.mockResolvedValue(checkoutRow({ status }));
      await expect(
        errorBody(service.cancel(buyer, checkoutId)),
      ).resolves.toEqual({
        message: 'Only an unpaid checkout can be cancelled',
        code: 'CHECKOUT_NOT_CANCELLABLE',
      });
      expect(tx.checkout.update).not.toHaveBeenCalled();
    });

    it("404s another buyer's checkout", async () => {
      tx.checkout.findFirst.mockResolvedValue(null);
      await expect(
        errorBody(service.cancel(buyer, checkoutId)),
      ).resolves.toMatchObject({ code: 'CHECKOUT_NOT_FOUND' });
    });
  });
});
