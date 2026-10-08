import { HttpException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart.service';
import { CartItemIssue } from '../dto';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const itemId = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const produce = {
  id: produceId,
  farmId: 'farm-1',
  name: 'Premium Cassava',
  unit: 'Tuber',
  imageUrl: null,
  pricePerUnit: new Prisma.Decimal('4500.00'),
  floatingQuantity: 500,
  status: ProduceStatus.PUBLISHED,
  type: ProduceType.LOCAL,
  farm: {
    id: 'farm-1',
    farmCode: 'LF-000123',
    verificationStatus: FarmVerificationStatus.VERIFIED,
  },
};

function cartRow(quantity: number, overrides: Partial<typeof produce> = {}) {
  return {
    id: itemId,
    buyerId: buyer.id,
    produceId,
    quantity,
    createdAt: new Date('2026-10-08'),
    updatedAt: new Date('2026-10-08'),
    produce: { ...produce, ...overrides },
  };
}

// The body HttpExceptionFilter reads `message` and `code` from.
async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('CartService', () => {
  const cartItem = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const tx = {
    $executeRaw: jest.fn(),
    cartItem,
    produce: { findUnique: jest.fn() },
  };
  const database = {
    cartItem,
    // A plain function, not jest.fn, so resetAllMocks keeps it.
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const service = new CartService(
    database as unknown as PrismaService,
    testCheckoutConfig(),
  );

  beforeEach(() => jest.resetAllMocks());

  describe('find', () => {
    it('prices lines from the current price and totals only clean items', async () => {
      cartItem.findMany.mockResolvedValue([
        cartRow(10),
        cartRow(2, { name: 'Yam', status: ProduceStatus.SOLD_OUT }),
      ]);
      const cart = await service.find(buyer);
      expect(cartItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buyerId: buyer.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(cart.itemCount).toBe(2);
      expect(cart.items[0].lineTotal).toBe('45000.00');
      expect(cart.total).toBe('45000.00');
    });

    it('adds the delivery fee to the grand total', async () => {
      cartItem.findMany.mockResolvedValue([cartRow(2)]);
      await expect(service.find(buyer)).resolves.toMatchObject({
        total: '9000.00',
        deliveryFee: '3500.00',
        grandTotal: '12500.00',
      });
    });

    it('charges no fee when nothing can be ordered', async () => {
      cartItem.findMany.mockResolvedValue([]);
      await expect(service.find(buyer)).resolves.toMatchObject({
        total: '0.00',
        deliveryFee: '0.00',
        grandTotal: '0.00',
      });
    });

    it('charges no fee when every item has an issue', async () => {
      cartItem.findMany.mockResolvedValue([
        cartRow(2, { status: ProduceStatus.SOLD_OUT }),
      ]);
      await expect(service.find(buyer)).resolves.toMatchObject({
        deliveryFee: '0.00',
        grandTotal: '0.00',
      });
    });

    it('flags an item whose farm lost verification instead of dropping it', async () => {
      cartItem.findMany.mockResolvedValue([
        cartRow(10, {
          farm: {
            ...produce.farm,
            verificationStatus: FarmVerificationStatus.PENDING,
          },
        }),
      ]);
      const cart = await service.find(buyer);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].issue).toBe(CartItemIssue.UNAVAILABLE);
      expect(cart.total).toBe('0.00');
    });

    it('flags an item asking for more than the floating stock', async () => {
      cartItem.findMany.mockResolvedValue([
        cartRow(10, { floatingQuantity: 8 }),
      ]);
      const cart = await service.find(buyer);
      expect(cart.items[0].issue).toBe(CartItemIssue.INSUFFICIENT_STOCK);
    });
  });

  describe('addItem', () => {
    it('serialises on the buyer’s cart lock', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(0);
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(10));
      await service.addItem(buyer, { produceId, quantity: 10 });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `cart:${buyer.id}`,
      );
    });

    it('adds to the quantity already in the cart', async () => {
      cartItem.findUnique.mockResolvedValue(cartRow(10));
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(15));
      const item = await service.addItem(buyer, { produceId, quantity: 5 });
      expect(cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buyerId_produceId: { buyerId: buyer.id, produceId } },
          create: { buyerId: buyer.id, produceId, quantity: 15 },
          update: { quantity: 15 },
        }),
      );
      expect(item.lineTotal).toBe('67500.00');
    });

    it('allows a quantity exactly equal to the floating stock', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(0);
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(500));
      await expect(
        service.addItem(buyer, { produceId, quantity: 500 }),
      ).resolves.toMatchObject({ quantity: 500, issue: null });
    });

    it('refuses when the merged quantity exceeds the floating stock', async () => {
      cartItem.findUnique.mockResolvedValue(cartRow(498));
      tx.produce.findUnique.mockResolvedValue(produce);
      await expect(
        service.addItem(buyer, { produceId, quantity: 5 }),
      ).rejects.toThrow('Only 500 Tuber available');
      expect(cartItem.upsert).not.toHaveBeenCalled();
    });

    it('treats a draft listing as not found', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(0);
      tx.produce.findUnique.mockResolvedValue({
        ...produce,
        status: ProduceStatus.DRAFT,
      });
      await expect(
        service.addItem(buyer, { produceId, quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('caps the cart at 50 distinct items', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(50);
      await expect(
        errorBody(service.addItem(buyer, { produceId, quantity: 1 })),
      ).resolves.toEqual({
        message: 'Your cart can hold at most 50 items',
        code: 'CART_FULL',
      });
    });

    it('lets an item already in a full cart grow', async () => {
      cartItem.findUnique.mockResolvedValue(cartRow(1));
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(2));
      await service.addItem(buyer, { produceId, quantity: 1 });
      expect(cartItem.count).not.toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    it('sets the quantity on the buyer’s own item', async () => {
      cartItem.findFirst.mockResolvedValue(cartRow(10));
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.update.mockResolvedValue(cartRow(3));
      await service.updateItem(buyer, itemId, { quantity: 3 });
      expect(cartItem.findFirst).toHaveBeenCalledWith({
        where: { id: itemId, buyerId: buyer.id },
      });
      expect(cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: itemId },
          data: { quantity: 3 },
        }),
      );
    });

    it('404s on another buyer’s item', async () => {
      cartItem.findFirst.mockResolvedValue(null);
      await expect(
        errorBody(service.updateItem(buyer, itemId, { quantity: 3 })),
      ).resolves.toEqual({
        message: 'Cart item not found',
        code: 'CART_ITEM_NOT_FOUND',
      });
      expect(cartItem.update).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('removes the buyer’s own item under the lock', async () => {
      cartItem.findFirst.mockResolvedValue(cartRow(10));
      cartItem.delete.mockResolvedValue(cartRow(10));
      await service.removeItem(buyer, itemId);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(cartItem.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: itemId } }),
      );
    });

    it('404s on another buyer’s item', async () => {
      cartItem.findFirst.mockResolvedValue(null);
      await expect(service.removeItem(buyer, itemId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(cartItem.delete).not.toHaveBeenCalled();
    });
  });
});
