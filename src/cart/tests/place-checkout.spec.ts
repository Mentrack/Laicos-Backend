import { HttpException } from '@nestjs/common';
import {
  CheckoutStatus,
  OrderStatus,
  Prisma,
  ProduceType,
} from '../../../generated/client';
import type { OrderLine } from '../../order/utils/reservation';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
import {
  createCheckout,
  resolveDelivery,
  type DeliverySnapshot,
} from '../utils/place-checkout';

const config = testCheckoutConfig();
// 10:00 in Lagos on 8 Oct: today is 2026-10-08, the window 09 Oct to 07 Nov.
const now = new Date('2026-10-08T09:00:00Z');
const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

const address = {
  id: 'address-1',
  buyerId: 'buyer-1',
  label: 'Warehouse A',
  street: '12, Bompai Industrial Area',
  contactName: 'Musa',
  contactPhone: '+2348012345678',
  state: { name: 'Kano' },
  lga: { name: 'Nassarawa' },
};

describe('resolveDelivery', () => {
  const tx = { address: { findFirst: jest.fn() } };
  const resolve = (deliveryDate: string) =>
    resolveDelivery(
      tx as unknown as Prisma.TransactionClient,
      'buyer-1',
      'address-1',
      deliveryDate,
      config,
      now,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.address.findFirst.mockResolvedValue(address);
  });

  it("snapshots the buyer's own address with the date", async () => {
    await expect(resolve('2026-10-09')).resolves.toEqual({
      deliveryDate: new Date('2026-10-09T00:00:00.000Z'),
      deliveryLabel: 'Warehouse A',
      deliveryStreet: '12, Bompai Industrial Area',
      deliveryState: 'Kano',
      deliveryLga: 'Nassarawa',
      deliveryContactName: 'Musa',
      deliveryContactPhone: '+2348012345678',
    });
    expect(tx.address.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'address-1', buyerId: 'buyer-1' },
      }),
    );
  });

  it("404s another buyer's address", async () => {
    tx.address.findFirst.mockResolvedValue(null);
    await expect(errorBody(resolve('2026-10-09'))).resolves.toEqual({
      message: 'Address not found',
      code: 'ADDRESS_NOT_FOUND',
    });
  });

  it.each(['2026-10-09', '2026-11-07'])('accepts the edge %s', async (date) => {
    await expect(resolve(date)).resolves.toBeDefined();
  });

  it.each(['2026-10-08', '2026-11-08', '2026-10-01'])(
    'refuses %s outside the window',
    async (date) => {
      await expect(errorBody(resolve(date))).resolves.toEqual({
        message: 'Delivery date must be between 2026-10-09 and 2026-11-07',
        code: 'INVALID_DELIVERY_DATE',
      });
    },
  );

  it('counts from Lagos today just before UTC midnight', async () => {
    // 23:30 UTC on 8 Oct is already 9 Oct in Lagos, so 9 Oct is too soon.
    await expect(
      errorBody(
        resolveDelivery(
          tx as unknown as Prisma.TransactionClient,
          'buyer-1',
          'address-1',
          '2026-10-09',
          config,
          new Date('2026-10-08T23:30:00Z'),
        ),
      ),
    ).resolves.toMatchObject({ code: 'INVALID_DELIVERY_DATE' });
  });
});

describe('createCheckout', () => {
  const tx = { checkout: { create: jest.fn() } };
  const delivery: DeliverySnapshot = {
    deliveryDate: new Date('2026-10-09T00:00:00.000Z'),
    deliveryLabel: 'Warehouse A',
    deliveryStreet: '12, Bompai Industrial Area',
    deliveryState: 'Kano',
    deliveryLga: 'Nassarawa',
    deliveryContactName: null,
    deliveryContactPhone: null,
  };
  const line = (produceId: string, total: string): OrderLine => ({
    produceId,
    farmId: 'farm-1',
    quantity: 10,
    produceName: `Produce ${produceId}`,
    type: ProduceType.LOCAL,
    totalPrice: new Prisma.Decimal(total),
  });
  const create = (expectedTotal: number) =>
    createCheckout(
      tx as unknown as Prisma.TransactionClient,
      {
        buyerId: 'buyer-1',
        idempotencyKey: key,
        lines: [line('a', '45000.00'), line('b', '9000.00')],
        delivery,
        expectedTotal,
      },
      config,
      now,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.checkout.create.mockResolvedValue({ id: 'checkout-1' });
  });

  it('adds the delivery fee and holds stock awaiting payment', async () => {
    await create(57500);
    const [{ data }] = tx.checkout.create.mock.calls[0] as [
      { data: Record<string, unknown> & { orders: { create: unknown[] } } },
    ];
    expect(data).toMatchObject({
      buyerId: 'buyer-1',
      idempotencyKey: key,
      status: CheckoutStatus.AWAITING_PAYMENT,
      expiresAt: new Date('2026-10-08T09:30:00Z'),
      ...delivery,
    });
    expect((data.subtotal as Prisma.Decimal).toFixed(2)).toBe('54000.00');
    expect((data.deliveryFee as Prisma.Decimal).toFixed(2)).toBe('3500.00');
    expect((data.totalPrice as Prisma.Decimal).toFixed(2)).toBe('57500.00');
    expect(data.orders.create).toEqual([
      expect.objectContaining({
        produceId: 'a',
        buyerId: 'buyer-1',
        status: OrderStatus.AWAITING_PAYMENT,
      }),
      expect.objectContaining({
        produceId: 'b',
        buyerId: 'buyer-1',
        status: OrderStatus.AWAITING_PAYMENT,
      }),
    ]);
  });

  it('refuses when the buyer saw a total without the fee', async () => {
    await expect(errorBody(create(54000))).resolves.toEqual({
      message: 'Prices in your cart have changed',
      code: 'CART_PRICE_CHANGED',
    });
    expect(tx.checkout.create).not.toHaveBeenCalled();
  });
});
