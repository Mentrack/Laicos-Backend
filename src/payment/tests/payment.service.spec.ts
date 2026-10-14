import { ConflictException, HttpException } from '@nestjs/common';
import {
  CheckoutStatus,
  Currency,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import { buyerProfile } from '../../buyer/tests/buyer.fixture';
import type { FxService } from '../../fx/fx.service';
import type {
  PaystackClient,
  VerifiedTransaction,
} from '../../paystack/paystack.client';
import type { PaystackConfig } from '../../paystack/paystack.config';
import { PaystackError } from '../../paystack/paystack-error';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment.service';
import type { RefundService } from '../refund.service';

const buyer = {
  id: 'buyer-1',
  role: Role.BUYER,
  email: 'buyer@example.com',
} as User;
const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const checkoutId = 'c0ffee00-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';

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
    provider: PaymentProvider.PAYSTACK,
    status: PaymentStatus.PENDING,
    amount: new Prisma.Decimal('57500'),
    currency: Currency.NGN,
    chargedAmount: new Prisma.Decimal('57500'),
    fxRate: null,
    channel: null,
    failureReason: null,
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
  let transactionOptions: unknown;
  const buyerModel = { findUnique: jest.fn() };
  const database = {
    buyer: buyerModel,
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: (
      callback: (client: typeof tx) => Promise<unknown>,
      options?: unknown,
    ) => {
      transactionOptions = options;
      return callback(tx);
    },
  };
  const paystack = {
    initializeTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
  };
  const refunds = { createAutomatic: jest.fn(), submit: jest.fn() };
  const fx = { effectiveRate: jest.fn() };
  const service = new PaymentService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
    { callbackUrl: 'https://app.laicos.test/cb' } as PaystackConfig,
    fx as unknown as FxService,
    refunds as unknown as RefundService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    buyerModel.findUnique.mockResolvedValue(buyerProfile('buyer-1'));
    tx.checkout.findFirst.mockResolvedValue(checkout());
    tx.payment.findUnique.mockResolvedValue(null);
    tx.payment.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(payment(data)),
    );
    tx.payment.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(payment(data)),
    );
    database.payment.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(payment(data)),
    );
    paystack.initializeTransaction.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
    });
  });

  describe('initiate', () => {
    const start = (currency: Currency) =>
      service.initiate(buyer, checkoutId, key, { currency });

    it('records a naira payment, then opens a Paystack checkout after commit', async () => {
      await expect(start(Currency.NGN)).resolves.toMatchObject({
        reference: 'PAY-000001',
        status: PaymentStatus.PENDING,
        currency: Currency.NGN,
        chargedAmount: '57500.00',
        authorizationUrl: 'https://checkout.paystack.com/abc',
        accessCode: 'abc',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `checkout:${checkoutId}`,
      );
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { checkoutId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.ABANDONED },
      });
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          checkoutId,
          idempotencyKey: key,
          provider: PaymentProvider.PAYSTACK,
          amount: new Prisma.Decimal('57500'),
          currency: Currency.NGN,
          chargedAmount: new Prisma.Decimal('57500'),
          fxRate: null,
        },
      });
      expect(transactionOptions).toEqual({ timeout: 15_000, maxWait: 5_000 });
      expect(paystack.initializeTransaction).toHaveBeenCalledWith({
        email: 'buyer@example.com',
        amount: 5_750_000,
        currency: Currency.NGN,
        reference: 'PAY-000001',
        callbackUrl: 'https://app.laicos.test/cb',
        channels: undefined,
        metadata: { checkoutId, paymentId: 'pay-1' },
      });
      expect(database.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          providerData: {
            authorizationUrl: 'https://checkout.paystack.com/abc',
            accessCode: 'abc',
          },
        },
      });
    });

    it('converts to dollars at the effective rate, card only', async () => {
      fx.effectiveRate.mockResolvedValue({
        rate: new Prisma.Decimal('1530.123456'),
        fetchedAt: new Date(),
      });
      // The stored row is what the response is built from, so echo it back.
      const usd = {
        currency: Currency.USD,
        chargedAmount: new Prisma.Decimal('37.58'),
        fxRate: new Prisma.Decimal('1530.123456'),
      };
      database.payment.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(payment({ ...usd, ...data })),
      );
      await expect(start(Currency.USD)).resolves.toMatchObject({
        currency: Currency.USD,
        amount: '57500.00',
        chargedAmount: '37.58',
        fxRate: '1530.123456',
      });
      expect(paystack.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3758,
          currency: Currency.USD,
          channels: ['card'],
        }),
      );
    });

    it('refuses dollars when the rate is stale, before recording anything', async () => {
      fx.effectiveRate.mockRejectedValue(
        new ConflictException({ message: 'stale', code: 'FX_RATE_STALE' }),
      );
      await expect(errorBody(start(Currency.USD))).resolves.toMatchObject({
        code: 'FX_RATE_STALE',
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('marks the attempt FAILED and answers 409 when Paystack is down', async () => {
      paystack.initializeTransaction.mockRejectedValue(
        new PaystackError('Paystack unreachable', null),
      );
      await expect(errorBody(start(Currency.NGN))).resolves.toEqual({
        message: 'The payment provider is unavailable; please try again',
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      });
      expect(database.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-1', status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: 'Paystack unreachable',
        },
      });
    });

    it('replays the attempt made with the same key without calling Paystack', async () => {
      tx.payment.findUnique.mockResolvedValue(
        payment({ providerData: { authorizationUrl: 'u', accessCode: 'a' } }),
      );
      await expect(start(Currency.NGN)).resolves.toMatchObject({
        id: 'pay-1',
        authorizationUrl: 'u',
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(paystack.initializeTransaction).not.toHaveBeenCalled();
    });

    it("404s another buyer's checkout", async () => {
      tx.checkout.findFirst.mockResolvedValue(null);
      await expect(errorBody(start(Currency.NGN))).resolves.toMatchObject({
        code: 'CHECKOUT_NOT_FOUND',
      });
    });

    it.each([
      ['paid', { status: CheckoutStatus.PAID }],
      ['expired', { status: CheckoutStatus.EXPIRED }],
      ['cancelled', { status: CheckoutStatus.CANCELLED }],
      ['past its hold', { expiresAt: new Date(Date.now() - 1000) }],
    ])('refuses a %s checkout', async (_label, overrides) => {
      tx.checkout.findFirst.mockResolvedValue(checkout(overrides));
      await expect(errorBody(start(Currency.NGN))).resolves.toEqual({
        message: 'This checkout can no longer be paid',
        code: 'CHECKOUT_NOT_PAYABLE',
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('applyVerifiedCharge', () => {
    const verified = (
      overrides: Partial<VerifiedTransaction> = {},
    ): VerifiedTransaction => ({
      reference: 'PAY-000001',
      status: 'success',
      amount: 5_750_000,
      currency: 'NGN',
      channel: 'card',
      ...overrides,
    });
    const apply = (
      overrides: Partial<VerifiedTransaction> = {},
      by: User | null = null,
    ) => service.applyVerifiedCharge(verified(overrides), by);

    beforeEach(() => {
      database.payment.findUnique.mockResolvedValue({ checkoutId });
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment(),
        checkout: checkout(),
      });
      refunds.createAutomatic.mockResolvedValue({
        id: 'refund-1',
        reason: 'x',
      });
    });

    it('pays the checkout and releases its orders to the farmers', async () => {
      await expect(apply()).resolves.toMatchObject({
        status: PaymentStatus.SUCCEEDED,
        channel: 'card',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `checkout:${checkoutId}`,
      );
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: expect.any(Date) as Date,
          channel: 'card',
          confirmedById: null,
        },
      });
      expect(tx.checkout.update).toHaveBeenCalledWith({
        where: { id: checkoutId },
        data: { status: CheckoutStatus.PAID, paidAt: expect.any(Date) as Date },
      });
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { checkoutId, status: OrderStatus.AWAITING_PAYMENT },
        data: { status: OrderStatus.PENDING },
      });
      expect(refunds.submit).not.toHaveBeenCalled();
    });

    it('records the admin who applied it', async () => {
      await apply({}, admin);
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ confirmedById: admin.id }) as unknown,
        }),
      );
    });

    it('still pays from an attempt the buyer since abandoned', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment({ status: PaymentStatus.ABANDONED }),
        checkout: checkout(),
      });
      await expect(apply()).resolves.toMatchObject({
        status: PaymentStatus.SUCCEEDED,
      });
    });

    it.each([PaymentStatus.SUCCEEDED, PaymentStatus.ORPHANED])(
      'answers a %s payment unchanged (webhook retries, re-verify)',
      async (status) => {
        tx.payment.findUniqueOrThrow.mockResolvedValue({
          ...payment({ status }),
          checkout: checkout({ status: CheckoutStatus.PAID }),
        });
        await expect(apply()).resolves.toMatchObject({ status });
        expect(tx.payment.update).not.toHaveBeenCalled();
        expect(refunds.createAutomatic).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['expired', checkout({ status: CheckoutStatus.EXPIRED }), {}],
      [
        'already paid by another attempt',
        checkout({ status: CheckoutStatus.PAID }),
        {},
      ],
      ['charged the wrong amount', checkout(), { amount: 100 }],
      ['charged in the wrong currency', checkout(), { currency: 'USD' }],
    ])(
      'orphans and refunds money for a checkout %s',
      async (_label, row, overrides) => {
        tx.payment.findUniqueOrThrow.mockResolvedValue({
          ...payment(),
          checkout: row,
        });
        await expect(apply(overrides)).resolves.toMatchObject({
          status: PaymentStatus.ORPHANED,
        });
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'pay-1' },
          data: {
            status: PaymentStatus.ORPHANED,
            failureReason: expect.any(String) as string,
            channel: 'card',
            paidAt: expect.any(Date) as Date,
          },
        });
        expect(refunds.createAutomatic).toHaveBeenCalledWith(
          tx,
          expect.objectContaining({ status: PaymentStatus.ORPHANED }),
          expect.any(String),
        );
        expect(refunds.submit).toHaveBeenCalledWith(
          { id: 'refund-1', reason: 'x' },
          'PAY-000001',
        );
        expect(tx.checkout.update).not.toHaveBeenCalled();
      },
    );

    it('still pays from an attempt that failed to open but was accepted by Paystack', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment({ status: PaymentStatus.FAILED }),
        checkout: checkout(),
      });
      await expect(apply()).resolves.toMatchObject({
        status: PaymentStatus.SUCCEEDED,
      });
      expect(tx.checkout.update).toHaveBeenCalledWith({
        where: { id: checkoutId },
        data: { status: CheckoutStatus.PAID, paidAt: expect.any(Date) as Date },
      });
    });

    it('orphans and refunds money that lands on a FAILED attempt of an expired checkout', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment({ status: PaymentStatus.FAILED }),
        checkout: checkout({ status: CheckoutStatus.EXPIRED }),
      });
      await expect(apply()).resolves.toMatchObject({
        status: PaymentStatus.ORPHANED,
      });
      expect(refunds.createAutomatic).toHaveBeenCalled();
      expect(refunds.submit).toHaveBeenCalled();
    });

    it('leaves an abandoned payment alone when Paystack says it failed', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment({ status: PaymentStatus.ABANDONED }),
        checkout: checkout(),
      });
      await apply({ status: 'failed' });
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('runs in the checkout transaction options', async () => {
      await apply();
      expect(transactionOptions).toEqual({ timeout: 15_000, maxWait: 5_000 });
    });

    it('marks a pending payment FAILED when Paystack says it failed', async () => {
      await expect(apply({ status: 'failed' })).resolves.toMatchObject({
        status: PaymentStatus.FAILED,
      });
    });

    it('leaves a payment alone while Paystack still calls it abandoned', async () => {
      await expect(apply({ status: 'abandoned' })).resolves.toMatchObject({
        status: PaymentStatus.PENDING,
      });
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('ignores an unknown reference', async () => {
      database.payment.findUnique.mockResolvedValue(null);
      await expect(apply()).resolves.toBeNull();
    });
  });

  describe('verify', () => {
    it('asks Paystack and applies the answer', async () => {
      database.payment.findUnique.mockResolvedValue({ checkoutId });
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment(),
        checkout: checkout(),
      });
      paystack.verifyTransaction.mockResolvedValue({
        reference: 'PAY-000001',
        status: 'success',
        amount: 5_750_000,
        currency: 'NGN',
        channel: 'card',
      });
      await expect(service.verify(admin, 'PAY-000001')).resolves.toMatchObject({
        status: PaymentStatus.SUCCEEDED,
      });
      expect(paystack.verifyTransaction).toHaveBeenCalledWith('PAY-000001');
    });

    it('404s an unknown reference without calling Paystack', async () => {
      database.payment.findUnique.mockResolvedValue(null);
      await expect(
        errorBody(service.verify(admin, 'PAY-999999')),
      ).resolves.toEqual({
        message: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND',
      });
      expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    });

    it('answers 409 when Paystack is down', async () => {
      database.payment.findUnique.mockResolvedValue({ checkoutId });
      paystack.verifyTransaction.mockRejectedValue(
        new PaystackError('down', null),
      );
      await expect(
        errorBody(service.verify(admin, 'PAY-000001')),
      ).resolves.toMatchObject({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      });
    });
  });
});
