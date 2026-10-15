import { HttpException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { buyerProfile } from '../../buyer/tests/buyer.fixture';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
import { CHECKOUT_TRANSACTION } from '../../payment/utils/checkout-transaction';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart.service';
import { CartItemIssue } from '../dto';
import {
  formatCartItem,
  formatCartLine,
  type CartItemRow,
} from '../formatters/cart.formatter';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const itemId = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const otherId = '1c3d5e7f-2a4b-4c6d-8e0f-1a2b3c4d5e6f';
const mergeKey = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
// Typed from the row, not inferred, so overrides can set any status.
type ProduceFixture = Pick<
  CartItemRow['produce'],
  | 'id'
  | 'farmId'
  | 'name'
  | 'unit'
  | 'imageUrl'
  | 'pricePerUnit'
  | 'floatingQuantity'
  | 'status'
  | 'type'
  | 'farm'
>;
const produce: ProduceFixture = {
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

function cartRow(quantity: number, overrides: Partial<ProduceFixture> = {}) {
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
    cartMerge: { findUnique: jest.fn(), create: jest.fn() },
  };
  const buyerModel = { findUnique: jest.fn() };
  const database = {
    cartItem,
    buyer: buyerModel,
    produce: { findMany: jest.fn() },
    // A plain function, not jest.fn, so resetAllMocks keeps it.
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const service = new CartService(
    database as unknown as PrismaService,
    testCheckoutConfig(),
  );

  beforeEach(() => {
    jest.resetAllMocks();
    buyerModel.findUnique.mockResolvedValue(buyerProfile(buyer.id));
  });

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

    it('adds a service fee on the item total to the grand total', async () => {
      const charging = new CartService(
        database as unknown as PrismaService,
        testCheckoutConfig({ SERVICE_FEE_PERCENT: '5' }),
      );
      cartItem.findMany.mockResolvedValue([cartRow(2)]);
      await expect(charging.find(buyer)).resolves.toMatchObject({
        total: '9000.00',
        deliveryFee: '3500.00',
        serviceFee: '450.00',
        grandTotal: '12950.00',
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

    it('formats a quote line exactly like a cart item, minus its id', () => {
      const row = cartRow(10);
      const { id, ...line } = formatCartItem(row);
      expect(id).toBe(itemId);
      expect(formatCartLine({ quantity: 10, produce: row.produce })).toEqual(
        line,
      );
    });
  });

  describe('quote', () => {
    it('prices device lines in request order with the delivery fee', async () => {
      database.produce.findMany.mockResolvedValue([
        { ...produce, id: otherId, name: 'Yam' },
        produce,
      ]);
      const quote = await service.quote({
        items: [
          { produceId, quantity: 10 },
          { produceId: otherId, quantity: 2 },
        ],
      });
      expect(quote.items.map((line) => line.produce.id)).toEqual([
        produceId,
        otherId,
      ]);
      expect(quote).toMatchObject({
        itemCount: 2,
        total: '54000.00',
        deliveryFee: '3500.00',
        grandTotal: '57500.00',
        unavailableProduceIds: [],
      });
    });

    it('looks up only listings a guest may see', async () => {
      database.produce.findMany.mockResolvedValue([]);
      await service.quote({ items: [{ produceId, quantity: 1 }] });
      expect(database.produce.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [produceId] },
            OR: [
              {
                status: {
                  in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT],
                },
                farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
              },
            ],
          },
        }),
      );
    });

    it('lists gone or hidden produce instead of pricing it', async () => {
      database.produce.findMany.mockResolvedValue([produce]);
      const quote = await service.quote({
        items: [
          { produceId, quantity: 1 },
          { produceId: otherId, quantity: 1 },
        ],
      });
      expect(quote.items).toHaveLength(1);
      expect(quote.unavailableProduceIds).toEqual([otherId]);
    });

    it('keeps a sold-out listing as a flagged line, not an unavailable id', async () => {
      database.produce.findMany.mockResolvedValue([
        { ...produce, status: ProduceStatus.SOLD_OUT },
      ]);
      const quote = await service.quote({
        items: [{ produceId, quantity: 1 }],
      });
      expect(quote.items[0].issue).toBe(CartItemIssue.UNAVAILABLE);
      expect(quote.unavailableProduceIds).toEqual([]);
      expect(quote).toMatchObject({ deliveryFee: '0.00', grandTotal: '0.00' });
    });

    it('flags a line over the floating stock', async () => {
      database.produce.findMany.mockResolvedValue([
        { ...produce, floatingQuantity: 3 },
      ]);
      const quote = await service.quote({
        items: [{ produceId, quantity: 5 }],
      });
      expect(quote.items[0].issue).toBe(CartItemIssue.INSUFFICIENT_STOCK);
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

  describe('mergeItems', () => {
    it('adds to existing lines under the lock and returns the whole cart', async () => {
      cartItem.findUnique.mockResolvedValue(cartRow(10));
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(15));
      cartItem.findMany.mockResolvedValue([cartRow(15)]);
      const cart = await service.mergeItems(buyer, mergeKey, {
        items: [{ produceId, quantity: 5 }],
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `cart:${buyer.id}`,
      );
      expect(cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: 15 } }),
      );
      expect(cartItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buyerId: buyer.id } }),
      );
      expect(cart).toMatchObject({
        itemCount: 1,
        total: '67500.00',
        skipped: [],
      });
    });

    it('skips an item over stock at the combined quantity and merges the rest', async () => {
      cartItem.findUnique
        .mockResolvedValueOnce(cartRow(498))
        .mockResolvedValueOnce(null);
      cartItem.count.mockResolvedValue(1);
      tx.produce.findUnique
        .mockResolvedValueOnce(produce)
        .mockResolvedValueOnce({ ...produce, id: otherId });
      cartItem.upsert.mockResolvedValue(cartRow(1));
      cartItem.findMany.mockResolvedValue([cartRow(498), cartRow(1)]);
      const cart = await service.mergeItems(buyer, mergeKey, {
        items: [
          { produceId, quantity: 5 },
          { produceId: otherId, quantity: 1 },
        ],
      });
      expect(cartItem.upsert).toHaveBeenCalledTimes(1);
      expect(cart.skipped).toEqual([
        {
          produceId,
          code: 'INSUFFICIENT_STOCK',
          message: 'Only 500 Tuber available',
        },
      ]);
    });

    it('reports a hidden or deleted produce as not found', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(0);
      tx.produce.findUnique.mockResolvedValue(null);
      cartItem.findMany.mockResolvedValue([]);
      const cart = await service.mergeItems(buyer, mergeKey, {
        items: [{ produceId, quantity: 1 }],
      });
      expect(cart.skipped).toEqual([
        { produceId, code: 'PRODUCE_NOT_FOUND', message: 'Produce not found' },
      ]);
    });

    it('grows an existing line in a full cart but skips new ones', async () => {
      cartItem.findUnique
        .mockResolvedValueOnce(cartRow(1))
        .mockResolvedValueOnce(null);
      cartItem.count.mockResolvedValue(50);
      tx.produce.findUnique.mockResolvedValue(produce);
      cartItem.upsert.mockResolvedValue(cartRow(2));
      cartItem.findMany.mockResolvedValue([cartRow(2)]);
      const cart = await service.mergeItems(buyer, mergeKey, {
        items: [
          { produceId, quantity: 1 },
          { produceId: otherId, quantity: 1 },
        ],
      });
      expect(cartItem.upsert).toHaveBeenCalledTimes(1);
      expect(cart.skipped).toEqual([
        {
          produceId: otherId,
          code: 'CART_FULL',
          message: 'Your cart can hold at most 50 items',
        },
      ]);
    });

    it('records the key with what it skipped, under the lock', async () => {
      cartItem.findUnique.mockResolvedValue(null);
      cartItem.count.mockResolvedValue(50);
      cartItem.findMany.mockResolvedValue([]);
      await service.mergeItems(buyer, mergeKey, {
        items: [{ produceId, quantity: 1 }],
      });
      expect(tx.cartMerge.findUnique).toHaveBeenCalledWith({
        where: {
          buyerId_idempotencyKey: {
            buyerId: buyer.id,
            idempotencyKey: mergeKey,
          },
        },
      });
      expect(tx.cartMerge.create).toHaveBeenCalledWith({
        data: {
          buyerId: buyer.id,
          idempotencyKey: mergeKey,
          skipped: [
            {
              produceId,
              code: 'CART_FULL',
              message: 'Your cart can hold at most 50 items',
            },
          ],
        },
      });
    });

    it('turns a transaction timeout into a retryable 409', async () => {
      const original = database.$transaction;
      database.$transaction = () =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError('timed out', {
            code: 'P2028',
            clientVersion: 'test',
          }),
        );
      try {
        await expect(
          errorBody(
            service.mergeItems(buyer, mergeKey, {
              items: [{ produceId, quantity: 1 }],
            }),
          ),
        ).resolves.toEqual({
          message: 'Your cart is busy; please try again',
          code: 'CART_BUSY',
        });
      } finally {
        database.$transaction = original;
      }
    });

    it('gives a 50-line merge the checkout transaction limits', async () => {
      const original = database.$transaction;
      const transaction = jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      );
      database.$transaction = transaction;
      cartItem.findMany.mockResolvedValue([]);
      try {
        await service.mergeItems(buyer, mergeKey, {
          items: [{ produceId, quantity: 1 }],
        });
        expect(transaction).toHaveBeenCalledWith(
          expect.any(Function),
          CHECKOUT_TRANSACTION,
        );
      } finally {
        database.$transaction = original;
      }
    });

    it('adds nothing on a repeated key and replays the original skipped list', async () => {
      const original = [
        { produceId: otherId, code: 'INSUFFICIENT_STOCK', message: 'x' },
      ];
      tx.cartMerge.findUnique.mockResolvedValue({ skipped: original });
      cartItem.findMany.mockResolvedValue([cartRow(15)]);
      const cart = await service.mergeItems(buyer, mergeKey, {
        items: [{ produceId, quantity: 5 }],
      });
      expect(cartItem.upsert).not.toHaveBeenCalled();
      expect(tx.cartMerge.create).not.toHaveBeenCalled();
      expect(cart).toMatchObject({ itemCount: 1, skipped: original });
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
