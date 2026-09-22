import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from '../order.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const farmer = { id: 'farmer-1', role: Role.FARMER } as User;
const orderId = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('OrderService', () => {
  const produce = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const order = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const tx = { produce, order };
  const database = {
    ...tx,
    // A plain function, not jest.fn, so resetAllMocks keeps it. Array form
    // for batched reads; callback form runs against the same mocks.
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const service = new OrderService(database as unknown as PrismaService);
  const published = {
    id: produceId,
    farmId: 'farm-1',
    quantity: 100,
    actualQuantity: 100,
    floatingQuantity: 100,
    unit: 'kg',
    status: ProduceStatus.PUBLISHED,
    pricePerUnit: new Prisma.Decimal('350.50'),
  };
  const pending = {
    id: orderId,
    produceId,
    buyerId: buyer.id,
    quantity: 5,
    status: OrderStatus.PENDING,
  };

  beforeEach(() => jest.resetAllMocks());

  describe('create', () => {
    it('reserves floating stock and prices the order', async () => {
      produce.updateMany.mockResolvedValue({ count: 1 });
      produce.findUnique.mockResolvedValue({
        ...published,
        floatingQuantity: 97,
      });
      await service.create(buyer, { produceId, quantity: 3 });
      expect(produce.updateMany).toHaveBeenCalledWith({
        where: {
          id: produceId,
          status: ProduceStatus.PUBLISHED,
          floatingQuantity: { gte: 3 },
        },
        data: { floatingQuantity: { decrement: 3 } },
      });
      const [[{ data }]] = order.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).toMatchObject({
        produceId,
        farmId: 'farm-1',
        buyerId: buyer.id,
        quantity: 3,
      });
      expect(String(data.totalPrice)).toBe('1051.5');
    });

    it('flips the listing to SOLD_OUT once the last unit is reserved', async () => {
      produce.updateMany.mockResolvedValue({ count: 1 });
      produce.findUnique.mockResolvedValue({
        ...published,
        floatingQuantity: 0,
      });
      await service.create(buyer, { produceId, quantity: 100 });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: { status: ProduceStatus.SOLD_OUT },
      });
    });

    it('treats a draft as not found', async () => {
      produce.updateMany.mockResolvedValue({ count: 0 });
      produce.findUnique.mockResolvedValue({
        ...published,
        status: ProduceStatus.DRAFT,
      });
      await expect(
        service.create(buyer, { produceId, quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(order.create).not.toHaveBeenCalled();
    });

    it('reports the floating stock when there is not enough', async () => {
      produce.updateMany.mockResolvedValue({ count: 0 });
      produce.findUnique.mockResolvedValue({
        ...published,
        floatingQuantity: 2,
      });
      await expect(
        service.create(buyer, { produceId, quantity: 3 }),
      ).rejects.toThrow('Only 2 kg available');
      expect(order.create).not.toHaveBeenCalled();
    });
  });

  it('filters a farmer’s orders by produce, status and produce type', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(4);
    const result = await service.findAll(farmer, {
      produceId,
      status: OrderStatus.PENDING,
      type: ProduceType.EXPORT,
    });
    const where = {
      farm: { owner: { userId: farmer.id } },
      produceId,
      status: OrderStatus.PENDING,
      produce: { type: ProduceType.EXPORT },
    };
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(order.count).toHaveBeenCalledWith({ where });
    expect(result.metaData.total).toBe(4);
  });

  it('scopes a buyer to their own orders', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await service.findAll(buyer, {});
    expect(order.count).toHaveBeenCalledWith({
      where: { buyerId: buyer.id, produceId: undefined, status: undefined },
    });
  });

  it('counts by status, with zeros for missing statuses including READY', async () => {
    order.groupBy.mockResolvedValue([
      { status: OrderStatus.PENDING, _count: { _all: 2 } },
      { status: OrderStatus.FULFILLED, _count: { _all: 5 } },
    ]);
    await expect(service.count(farmer, { produceId })).resolves.toEqual({
      total: 7,
      byStatus: {
        PENDING: 2,
        CONFIRMED: 0,
        READY: 0,
        FULFILLED: 5,
        CANCELLED: 0,
      },
    });
  });

  describe('confirm', () => {
    it('confirms a pending order and commits actual stock', async () => {
      order.findFirst.mockResolvedValue(pending);
      produce.findUniqueOrThrow.mockResolvedValue(published);
      await service.confirm(farmer, orderId);
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CONFIRMED },
      });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          actualQuantity: { decrement: 5 },
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('flips to SOLD_OUT when confirming exhausts actual stock', async () => {
      order.findFirst.mockResolvedValue({ ...pending, quantity: 100 });
      produce.findUniqueOrThrow.mockResolvedValue(published);
      await service.confirm(farmer, orderId);
      expect(produce.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProduceStatus.SOLD_OUT }),
        }),
      );
    });

    it('refuses anything but a pending order', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CANCELLED,
      });
      await expect(service.confirm(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.update).not.toHaveBeenCalled();
    });

    it('maps a concurrent status change to 409', async () => {
      order.findFirst.mockResolvedValue(pending);
      order.update.mockRejectedValue(prismaError('P2025'));
      await expect(service.confirm(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(produce.update).not.toHaveBeenCalled();
    });
  });

  describe('markReady', () => {
    it('moves a confirmed order to READY', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await service.markReady(farmer, orderId);
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.CONFIRMED },
        data: { status: OrderStatus.READY },
      });
    });

    it('refuses anything but a confirmed order', async () => {
      order.findFirst.mockResolvedValue(pending);
      await expect(service.markReady(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const reason = 'Rain damaged the harvest';

    it('records the reason and returns only floating stock for a pending order', async () => {
      order.findFirst.mockResolvedValue(pending);
      produce.findUniqueOrThrow.mockResolvedValue(published);
      await service.cancel(farmer, orderId, { reason });
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancellationReason: reason },
      });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: 105,
          actualQuantity: 100,
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('returns actual and floating stock for a confirmed order', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      produce.findUniqueOrThrow.mockResolvedValue(published);
      await service.cancel(farmer, orderId, { reason });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: 105,
          actualQuantity: 105,
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('flips a SOLD_OUT listing back to PUBLISHED once stock is returned', async () => {
      order.findFirst.mockResolvedValue(pending);
      produce.findUniqueOrThrow.mockResolvedValue({
        ...published,
        actualQuantity: 5,
        floatingQuantity: 0,
        status: ProduceStatus.SOLD_OUT,
      });
      await service.cancel(farmer, orderId, { reason });
      expect(produce.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProduceStatus.PUBLISHED }),
        }),
      );
    });

    it('does not let a buyer cancel a confirmed order', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await expect(
        service.cancel(buyer, orderId, { reason }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(order.update).not.toHaveBeenCalled();
    });

    it('lets a farmer cancel a confirmed order', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      produce.findUniqueOrThrow.mockResolvedValue(published);
      order.update.mockResolvedValue({
        ...pending,
        status: OrderStatus.CANCELLED,
      });
      await expect(
        service.cancel(farmer, orderId, { reason }),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('deletes the buyer’s pending order and releases its stock', async () => {
      order.findFirst.mockResolvedValue(pending);
      produce.findUniqueOrThrow.mockResolvedValue(published);
      await service.remove(buyer, orderId);
      expect(order.delete).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.PENDING },
      });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: 105,
          actualQuantity: 100,
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('refuses once the order has left PENDING', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await expect(service.remove(buyer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.delete).not.toHaveBeenCalled();
    });
  });
});
