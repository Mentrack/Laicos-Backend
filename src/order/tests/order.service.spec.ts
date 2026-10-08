import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  OrderStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { addDays, lagosToday } from '../../common/dates';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
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
    aggregate: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const orderChecklist = {
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const farm = { findUniqueOrThrow: jest.fn() };
  const checkout = { findUnique: jest.fn(), create: jest.fn() };
  const address = { findFirst: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    produce,
    order,
    orderChecklist,
    farm,
    checkout,
    address,
  };
  const database = {
    ...tx,
    // A plain function, not jest.fn, so resetAllMocks keeps it. Array form
    // for batched reads; callback form runs against the same mocks.
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const service = new OrderService(
    database as unknown as PrismaService,
    testCheckoutConfig(),
  );
  const published = {
    id: produceId,
    farmId: 'farm-1',
    name: 'Premium Sesame Seeds',
    quantity: 100,
    actualQuantity: 100,
    floatingQuantity: 100,
    unit: 'kg',
    status: ProduceStatus.PUBLISHED,
    type: ProduceType.EXPORT,
    pricePerUnit: new Prisma.Decimal('350.50'),
    farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
  };
  const pending = {
    id: orderId,
    produceId,
    buyerId: buyer.id,
    quantity: 5,
    status: OrderStatus.PENDING,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    produce.update.mockResolvedValue(published);
  });

  describe('create (Buy Now)', () => {
    const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';
    const dto = {
      produceId,
      quantity: 10,
      addressId: 'address-1',
      deliveryDate: addDays(lagosToday(), 2),
      expectedTotal: 0, // set per test
    };
    const placed = {
      id: 'checkout-1',
      checkoutNumber: 'CHK-000001',
      buyerId: buyer.id,
      status: 'AWAITING_PAYMENT',
      subtotal: new Prisma.Decimal('0'),
      deliveryFee: new Prisma.Decimal('3500'),
      totalPrice: new Prisma.Decimal('3500'),
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
    };

    beforeEach(() => {
      tx.checkout.findUnique.mockResolvedValue(null);
      tx.address.findFirst.mockResolvedValue({
        label: 'Warehouse A',
        street: '1 Road',
        contactName: null,
        contactPhone: null,
        state: { name: 'Kano' },
        lga: { name: 'Nassarawa' },
      });
      tx.checkout.create.mockResolvedValue(placed);
    });

    it('places a one-line checkout awaiting payment under the cart lock', async () => {
      produce.updateMany.mockResolvedValue({ count: 1 });
      produce.findUnique.mockResolvedValue(published);
      const total = published.pricePerUnit.mul(10).add(3500).toNumber();
      await expect(
        service.create(buyer, key, { ...dto, expectedTotal: total }),
      ).resolves.toMatchObject({
        id: 'checkout-1',
        status: 'AWAITING_PAYMENT',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `cart:${buyer.id}`,
      );
      expect(tx.checkout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orders: {
              create: [
                expect.objectContaining({
                  produceId,
                  quantity: 10,
                  status: OrderStatus.AWAITING_PAYMENT,
                }),
              ],
            },
          }) as unknown,
        }),
      );
      expect(order.create).not.toHaveBeenCalled();
    });

    it('replays an earlier Buy Now with the same key', async () => {
      tx.checkout.findUnique.mockResolvedValue(placed);
      await expect(
        service.create(buyer, key, { ...dto, expectedTotal: 1 }),
      ).resolves.toMatchObject({ id: 'checkout-1' });
      expect(produce.updateMany).not.toHaveBeenCalled();
    });

    it('refuses an unknown address before reserving', async () => {
      tx.address.findFirst.mockResolvedValue(null);
      await expect(
        service.create(buyer, key, { ...dto, expectedTotal: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'ADDRESS_NOT_FOUND' },
      });
      expect(produce.updateMany).not.toHaveBeenCalled();
    });

    it('refuses sold-out produce with the Buy Now message', async () => {
      produce.updateMany.mockResolvedValue({ count: 0 });
      produce.findUnique.mockResolvedValue({
        ...published,
        status: ProduceStatus.SOLD_OUT,
      });
      await expect(
        service.create(buyer, key, { ...dto, expectedTotal: 1 }),
      ).rejects.toMatchObject({ response: { code: 'PRODUCE_UNAVAILABLE' } });
    });
  });

  it('filters a farmer’s orders by produce, status and order type', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(4);
    const result = await service.findAll(farmer, {
      produceId,
      status: OrderStatus.PENDING,
      type: ProduceType.EXPORT,
    });
    const where = {
      farm: { owner: { userId: farmer.id } },
      NOT: { status: OrderStatus.AWAITING_PAYMENT },
      produceId,
      status: OrderStatus.PENDING,
      type: ProduceType.EXPORT,
    };
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(order.count).toHaveBeenCalledWith({ where });
    expect(result.metaData.total).toBe(4);
  });

  it('hides unpaid orders from farmers even when filtering by status', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await service.findAll(farmer, { status: undefined });
    await service.findAll(farmer, { status: OrderStatus.AWAITING_PAYMENT });
    for (const [args] of order.findMany.mock.calls as [
      { where: Prisma.OrderWhereInput },
    ][]) {
      expect(args.where.NOT).toEqual({
        status: OrderStatus.AWAITING_PAYMENT,
      });
    }
  });

  it('shows buyers their unpaid orders', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await service.findAll(buyer, {});
    const [[args]] = order.findMany.mock.calls as [
      { where: Prisma.OrderWhereInput },
    ][];
    expect(args.where.NOT).toBeUndefined();
  });

  it.each(['cancel', 'remove'] as const)(
    '%s refuses an order still awaiting payment',
    async (action) => {
      order.findFirst.mockResolvedValue({
        id: orderId,
        buyerId: buyer.id,
        status: OrderStatus.AWAITING_PAYMENT,
      });
      const call =
        action === 'cancel'
          ? service.cancel(buyer, orderId, { reason: 'changed my mind' })
          : service.remove(buyer, orderId);
      await expect(call).rejects.toMatchObject({
        response: {
          message: 'Cancel the checkout instead',
          code: 'ORDER_IN_CHECKOUT',
        },
      });
      expect(order.update).not.toHaveBeenCalled();
      expect(order.delete).not.toHaveBeenCalled();
    },
  );

  it('scopes a buyer to their own orders', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await service.findAll(buyer, {});
    expect(order.count).toHaveBeenCalledWith({
      where: {
        buyerId: buyer.id,
        produceId: undefined,
        status: undefined,
        type: undefined,
      },
    });
  });

  it('counts by status, with zeros for every missing status', async () => {
    order.groupBy.mockResolvedValue([
      { status: OrderStatus.PENDING, _count: { _all: 2 } },
      { status: OrderStatus.FULFILLED, _count: { _all: 5 } },
    ]);
    await expect(service.count(farmer, { produceId })).resolves.toEqual({
      total: 7,
      byStatus: {
        AWAITING_PAYMENT: 0,
        PENDING: 2,
        CONFIRMED: 0,
        PREPARING: 0,
        READY: 0,
        SHIPPED: 0,
        FULFILLED: 5,
        CANCELLED: 0,
      },
    });
  });

  describe('summary', () => {
    const scope = {
      farm: { owner: { userId: farmer.id } },
      NOT: { status: OrderStatus.AWAITING_PAYMENT },
    };

    it('sums fulfilled orders and counts active ones', async () => {
      order.aggregate.mockResolvedValue({
        _sum: { totalPrice: new Prisma.Decimal('450000') },
      });
      order.count.mockResolvedValue(3);
      await expect(service.summary(farmer)).resolves.toEqual({
        totalEarnings: '450000.00',
        activeOrders: 3,
      });
      expect(order.aggregate).toHaveBeenCalledWith({
        where: { ...scope, status: OrderStatus.FULFILLED },
        _sum: { totalPrice: true },
      });
      expect(order.count).toHaveBeenCalledWith({
        where: {
          ...scope,
          status: {
            in: [
              OrderStatus.PENDING,
              OrderStatus.CONFIRMED,
              OrderStatus.PREPARING,
              OrderStatus.READY,
              OrderStatus.SHIPPED,
            ],
          },
        },
      });
    });

    it('reports zero earnings when nothing is fulfilled', async () => {
      order.aggregate.mockResolvedValue({ _sum: { totalPrice: null } });
      order.count.mockResolvedValue(0);
      await expect(service.summary(farmer)).resolves.toEqual({
        totalEarnings: '0.00',
        activeOrders: 0,
      });
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

  const preparing = { ...pending, status: OrderStatus.PREPARING };
  const ticked = {
    orderId,
    harvested: true,
    sorted: true,
    packaged: true,
    readyForPickup: true,
  };

  describe('prepare', () => {
    it('moves a confirmed order to PREPARING and opens its checklist', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await service.prepare(farmer, orderId);
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.CONFIRMED },
        data: { status: OrderStatus.PREPARING, checklist: { create: {} } },
      });
    });

    it('refuses anything but a confirmed order', async () => {
      order.findFirst.mockResolvedValue(pending);
      await expect(service.prepare(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.update).not.toHaveBeenCalled();
    });
  });

  describe('checklist', () => {
    it('is scoped to the caller and 404s before preparation starts', async () => {
      orderChecklist.findFirst.mockResolvedValue(null);
      await expect(
        service.findChecklist(farmer, orderId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderChecklist.findFirst).toHaveBeenCalledWith({
        where: {
          orderId,
          order: {
            farm: { owner: { userId: farmer.id } },
            NOT: { status: OrderStatus.AWAITING_PAYMENT },
          },
        },
      });
    });

    it('ticks items only while the order is PREPARING', async () => {
      order.findFirst.mockResolvedValue(preparing);
      await service.updateChecklist(farmer, orderId, { sorted: true });
      expect(orderChecklist.update).toHaveBeenCalledWith({
        where: { orderId, order: { status: OrderStatus.PREPARING } },
        data: { sorted: true },
      });
    });

    it('refuses changes once the order has moved on', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.READY,
      });
      await expect(
        service.updateChecklist(farmer, orderId, { sorted: false }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orderChecklist.update).not.toHaveBeenCalled();
    });
  });

  describe('markReady', () => {
    beforeEach(() =>
      farm.findUniqueOrThrow.mockResolvedValue({
        cluster: { agentId: 'agent-1' },
      }),
    );

    it('moves a fully prepared order to READY, re-checking the checklist', async () => {
      order.findFirst.mockResolvedValue(preparing);
      orderChecklist.findFirst.mockResolvedValue(ticked);
      await service.markReady(farmer, orderId);
      expect(order.update).toHaveBeenCalledWith({
        where: {
          id: orderId,
          status: OrderStatus.PREPARING,
          checklist: {
            is: {
              harvested: true,
              sorted: true,
              packaged: true,
              readyForPickup: true,
            },
          },
        },
        data: {
          status: OrderStatus.READY,
          handover: { create: { agentId: 'agent-1' } },
        },
      });
    });

    it('leaves the handover unassigned when the farm is in no cluster', async () => {
      order.findFirst.mockResolvedValue({ ...preparing, farmId: 'farm-1' });
      orderChecklist.findFirst.mockResolvedValue(ticked);
      farm.findUniqueOrThrow.mockResolvedValue({ cluster: null });
      await service.markReady(farmer, orderId);
      expect(farm.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'farm-1' },
        select: { cluster: { select: { agentId: true } } },
      });
      expect(order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: OrderStatus.READY,
            handover: { create: { agentId: null } },
          },
        }),
      );
    });

    it('names the unticked items', async () => {
      order.findFirst.mockResolvedValue(preparing);
      orderChecklist.findFirst.mockResolvedValue({
        ...ticked,
        sorted: false,
        packaged: false,
      });
      await expect(service.markReady(farmer, orderId)).rejects.toThrow(
        'unticked: sorted, packaged',
      );
      expect(order.update).not.toHaveBeenCalled();
    });

    it('refuses a confirmed order that skipped preparation', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await expect(service.markReady(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.update).not.toHaveBeenCalled();
    });

    it('maps an item unticked mid-request to 409', async () => {
      order.findFirst.mockResolvedValue(preparing);
      orderChecklist.findFirst.mockResolvedValue(ticked);
      order.update.mockRejectedValue(prismaError('P2025'));
      await expect(service.markReady(farmer, orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    const reason = 'Rain damaged the harvest';

    it('records the reason and returns only floating stock for a pending order', async () => {
      order.findFirst.mockResolvedValue(pending);
      await service.cancel(farmer, orderId, { reason });
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancellationReason: reason },
      });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: { increment: 5 },
        },
      });
    });

    it('returns actual and floating stock for a confirmed order', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.CONFIRMED,
      });
      await service.cancel(farmer, orderId, { reason });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: { increment: 5 },
          actualQuantity: { increment: 5 },
        },
      });
    });

    it('flips a SOLD_OUT listing back to PUBLISHED once stock is returned', async () => {
      order.findFirst.mockResolvedValue(pending);
      produce.update.mockResolvedValue({
        ...published,
        actualQuantity: 5,
        floatingQuantity: 5,
        status: ProduceStatus.SOLD_OUT,
      });
      await service.cancel(farmer, orderId, { reason });
      expect(produce.update).toHaveBeenLastCalledWith({
        where: { id: produceId },
        data: { status: ProduceStatus.PUBLISHED },
      });
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
      order.update.mockResolvedValue({
        ...pending,
        status: OrderStatus.CANCELLED,
      });
      await expect(
        service.cancel(farmer, orderId, { reason }),
      ).resolves.toBeDefined();
    });

    it('lets a farmer cancel mid-preparation, returning actual stock', async () => {
      order.findFirst.mockResolvedValue(preparing);
      await service.cancel(farmer, orderId, { reason });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: { increment: 5 },
          actualQuantity: { increment: 5 },
        },
      });
    });

    it('does not let a farmer cancel once the order is READY', async () => {
      order.findFirst.mockResolvedValue({
        ...pending,
        status: OrderStatus.READY,
      });
      await expect(
        service.cancel(farmer, orderId, { reason }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes the buyer’s pending order and releases its stock', async () => {
      order.findFirst.mockResolvedValue(pending);
      await service.remove(buyer, orderId);
      expect(order.delete).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.PENDING },
      });
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId },
        data: {
          floatingQuantity: { increment: 5 },
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
