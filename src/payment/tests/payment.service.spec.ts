import { HttpException } from '@nestjs/common';
import {
  CheckoutStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment.service';
import { testCheckoutConfig } from './checkout-config.fixture';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const checkoutId = 'c0ffee00-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';
const HOUR = 3_600_000;

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    id: checkoutId,
    buyerId: buyer.id,
    status: CheckoutStatus.AWAITING_PAYMENT,
    totalPrice: new Prisma.Decimal('57500'),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    reference: 'PAY-000001',
    checkoutId,
    idempotencyKey: key,
    method: PaymentMethod.CARD,
    provider: PaymentProvider.STUB,
    status: PaymentStatus.PENDING,
    amount: new Prisma.Decimal('57500'),
    providerData: null,
    confirmedById: null,
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PaymentService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    checkout: { findFirst: jest.fn(), update: jest.fn() },
    payment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    order: { updateMany: jest.fn() },
  };
  const database = {
    payment: { findUnique: jest.fn() },
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const provider = {
    provider: PaymentProvider.STUB,
    initiate: jest.fn(),
  };
  const service = new PaymentService(
    database as unknown as PrismaService,
    testCheckoutConfig(),
    provider,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.checkout.findFirst.mockResolvedValue(checkout());
    tx.payment.findUnique.mockResolvedValue(null);
    tx.payment.create.mockResolvedValue(payment());
    tx.payment.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(payment(data)),
    );
    provider.initiate.mockResolvedValue({
      authorizationUrl: null,
      bankTransfer: null,
    });
  });

  describe('initiate', () => {
    const start = (method: PaymentMethod) =>
      service.initiate(buyer, checkoutId, key, { method });

    it('abandons earlier attempts and records a pending payment for the total', async () => {
      const created = payment();
      tx.payment.create.mockResolvedValue(created);
      await expect(start(PaymentMethod.CARD)).resolves.toMatchObject({
        reference: 'PAY-000001',
        status: PaymentStatus.PENDING,
        amount: '57500.00',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `checkout:${checkoutId}`,
      );
      expect(tx.checkout.findFirst).toHaveBeenCalledWith({
        where: { id: checkoutId, buyerId: buyer.id },
      });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { checkoutId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.ABANDONED },
      });
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          checkoutId,
          idempotencyKey: key,
          method: PaymentMethod.CARD,
          provider: PaymentProvider.STUB,
          amount: new Prisma.Decimal('57500'),
        },
      });
      expect(provider.initiate).toHaveBeenCalledWith(created);
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          providerData: { authorizationUrl: null, bankTransfer: null },
        },
      });
    });

    it('leaves the hold alone for a card payment', async () => {
      await start(PaymentMethod.CARD);
      expect(tx.checkout.update).not.toHaveBeenCalled();
    });

    it('extends the hold to 24h for a bank transfer', async () => {
      const before = Date.now();
      await start(PaymentMethod.BANK_TRANSFER);
      const [{ data }] = tx.checkout.update.mock.calls[0] as [
        { data: { expiresAt: Date } },
      ];
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 24 * HOUR,
      );
    });

    it('never shortens a hold that is already longer', async () => {
      tx.checkout.findFirst.mockResolvedValue(
        checkout({ expiresAt: new Date(Date.now() + 48 * HOUR) }),
      );
      await start(PaymentMethod.BANK_TRANSFER);
      expect(tx.checkout.update).not.toHaveBeenCalled();
    });

    it('replays the attempt made with the same key', async () => {
      tx.payment.findUnique.mockResolvedValue(payment());
      await expect(start(PaymentMethod.CARD)).resolves.toMatchObject({
        id: 'pay-1',
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.payment.findUnique).toHaveBeenCalledWith({
        where: {
          checkoutId_idempotencyKey: { checkoutId, idempotencyKey: key },
        },
      });
    });

    it("404s another buyer's checkout", async () => {
      tx.checkout.findFirst.mockResolvedValue(null);
      await expect(errorBody(start(PaymentMethod.CARD))).resolves.toMatchObject(
        { code: 'CHECKOUT_NOT_FOUND' },
      );
    });

    it.each([
      ['paid', { status: CheckoutStatus.PAID }],
      ['expired', { status: CheckoutStatus.EXPIRED }],
      ['cancelled', { status: CheckoutStatus.CANCELLED }],
      ['past its hold', { expiresAt: new Date(Date.now() - 1000) }],
    ])('refuses a %s checkout', async (_label, overrides) => {
      tx.checkout.findFirst.mockResolvedValue(checkout(overrides));
      await expect(errorBody(start(PaymentMethod.CARD))).resolves.toEqual({
        message: 'This checkout can no longer be paid',
        code: 'CHECKOUT_NOT_PAYABLE',
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      database.payment.findUnique.mockResolvedValue({ checkoutId });
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment(),
        checkout: checkout(),
      });
    });

    it('pays the checkout and releases its orders to the farmers', async () => {
      await expect(service.confirm('PAY-000001', admin)).resolves.toMatchObject(
        { status: PaymentStatus.SUCCEEDED },
      );
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `checkout:${checkoutId}`,
      );
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: expect.any(Date) as Date,
          confirmedById: admin.id,
        },
      });
      expect(tx.checkout.update).toHaveBeenCalledWith({
        where: { id: checkoutId },
        data: {
          status: CheckoutStatus.PAID,
          paidAt: expect.any(Date) as Date,
        },
      });
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { checkoutId, status: OrderStatus.AWAITING_PAYMENT },
        data: { status: OrderStatus.PENDING },
      });
    });

    it('still pays a checkout past its hold that the sweep has not reached', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment(),
        checkout: checkout({ expiresAt: new Date(Date.now() - 1000) }),
      });
      await expect(service.confirm('PAY-000001', admin)).resolves.toMatchObject(
        { status: PaymentStatus.SUCCEEDED },
      );
    });

    it('records no confirmer for a provider confirmation', async () => {
      await service.confirm('PAY-000001', null);
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ confirmedById: null }) as unknown,
        }),
      );
    });

    it('returns an already successful payment unchanged', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment({ status: PaymentStatus.SUCCEEDED }),
        checkout: checkout({ status: CheckoutStatus.PAID }),
      });
      await expect(service.confirm('PAY-000001', admin)).resolves.toMatchObject(
        { status: PaymentStatus.SUCCEEDED },
      );
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('404s an unknown reference', async () => {
      database.payment.findUnique.mockResolvedValue(null);
      await expect(
        errorBody(service.confirm('PAY-999999', admin)),
      ).resolves.toEqual({
        message: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND',
      });
    });

    it.each([PaymentStatus.ABANDONED, PaymentStatus.FAILED])(
      'refuses a %s payment',
      async (status) => {
        tx.payment.findUniqueOrThrow.mockResolvedValue({
          ...payment({ status }),
          checkout: checkout(),
        });
        await expect(
          errorBody(service.confirm('PAY-000001', admin)),
        ).resolves.toEqual({
          message: `This payment is ${status} and can't be confirmed`,
          code: 'PAYMENT_NOT_PENDING',
        });
      },
    );

    it.each([CheckoutStatus.EXPIRED, CheckoutStatus.CANCELLED])(
      'refuses to pay a %s checkout',
      async (status) => {
        tx.payment.findUniqueOrThrow.mockResolvedValue({
          ...payment(),
          checkout: checkout({ status }),
        });
        await expect(
          errorBody(service.confirm('PAY-000001', admin)),
        ).resolves.toEqual({
          message: 'This checkout expired before payment was confirmed',
          code: 'CHECKOUT_EXPIRED',
        });
        expect(tx.order.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
