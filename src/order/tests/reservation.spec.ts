import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  OrderStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  type Order,
  type Produce,
} from '../../../generated/client';
import {
  isOrderable,
  linePrice,
  orderLine,
  orderRefusal,
  releaseStock,
} from '../utils/reservation';

const produce = {
  id: 'produce-1',
  farmId: 'farm-1',
  name: 'Premium Cassava',
  unit: 'Tuber',
  floatingQuantity: 500,
  status: ProduceStatus.PUBLISHED,
  type: ProduceType.LOCAL,
  pricePerUnit: new Prisma.Decimal('4500.00'),
  farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
} as Produce & { farm: { verificationStatus: FarmVerificationStatus } };

describe('reservation', () => {
  it('allows a quantity equal to the floating stock', () => {
    expect(isOrderable(produce, 500)).toBe(true);
    expect(isOrderable(produce, 501)).toBe(false);
  });

  it('refuses drafts and unverified farms as not found', () => {
    expect(isOrderable({ ...produce, status: ProduceStatus.DRAFT }, 1)).toBe(
      false,
    );
    expect(orderRefusal(null)).toBeInstanceOf(NotFoundException);
    expect(orderRefusal(null).getResponse()).toEqual({
      message: 'Produce not found',
      code: 'PRODUCE_NOT_FOUND',
    });
    expect(
      orderRefusal({
        ...produce,
        farm: { verificationStatus: FarmVerificationStatus.PENDING },
      }),
    ).toBeInstanceOf(NotFoundException);
  });

  it('refuses a sold-out listing as a conflict', () => {
    const refusal = orderRefusal({
      ...produce,
      status: ProduceStatus.SOLD_OUT,
    });
    expect(refusal).toBeInstanceOf(ConflictException);
    expect(refusal.getResponse()).toEqual({
      message: 'Produce is not available for ordering',
      code: 'PRODUCE_UNAVAILABLE',
    });
  });

  it('names the floating stock when there is not enough', () => {
    expect(
      orderRefusal({ ...produce, floatingQuantity: 8 }).getResponse(),
    ).toEqual({
      message: 'Only 8 Tuber available',
      code: 'INSUFFICIENT_STOCK',
    });
  });

  it('prices a line to 2 dp', () => {
    expect(linePrice(new Prisma.Decimal('350.50'), 3).toFixed(2)).toBe(
      '1051.50',
    );
  });

  it('builds the order fields from the produce', () => {
    expect(orderLine(produce, 10)).toEqual({
      produceId: 'produce-1',
      farmId: 'farm-1',
      quantity: 10,
      produceName: 'Premium Cassava',
      type: ProduceType.LOCAL,
      totalPrice: new Prisma.Decimal('45000'),
    });
  });
});

describe('releaseStock', () => {
  const tx = { produce: { update: jest.fn() } };
  const client = tx as unknown as Prisma.TransactionClient;
  const order = {
    produceId: 'p1',
    quantity: 5,
  } as Order;

  beforeEach(() => {
    jest.resetAllMocks();
    tx.produce.update.mockResolvedValue({
      id: 'p1',
      status: ProduceStatus.PUBLISHED,
      actualQuantity: 50,
      floatingQuantity: 10,
    });
  });

  it.each([OrderStatus.AWAITING_PAYMENT, OrderStatus.PENDING])(
    'returns only floating stock for a %s order, atomically',
    async (status) => {
      await releaseStock(client, { ...order, status });
      expect(tx.produce.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { floatingQuantity: { increment: 5 } },
      });
    },
  );

  it('returns actual stock too once the order was confirmed', async () => {
    await releaseStock(client, { ...order, status: OrderStatus.CONFIRMED });
    expect(tx.produce.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        floatingQuantity: { increment: 5 },
        actualQuantity: { increment: 5 },
      },
    });
  });

  it('flips a sold-out listing back to published', async () => {
    tx.produce.update.mockResolvedValueOnce({
      id: 'p1',
      status: ProduceStatus.SOLD_OUT,
      actualQuantity: 50,
      floatingQuantity: 5,
    });
    await releaseStock(client, { ...order, status: OrderStatus.PENDING });
    expect(tx.produce.update).toHaveBeenLastCalledWith({
      where: { id: 'p1' },
      data: { status: ProduceStatus.PUBLISHED },
    });
  });
});
