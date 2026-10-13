import { HttpException } from '@nestjs/common';
import {
  Currency,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  RefundStatus,
  Role,
  type User,
} from '../../../generated/client';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundService } from '../refund.service';

const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const d = (value: string) => new Prisma.Decimal(value);

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

// A ₦60,200 checkout (54,000 items + 3,500 delivery + 2,700 service fee).
function paid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    reference: 'PAY-000001',
    checkoutId: 'checkout-1',
    status: PaymentStatus.SUCCEEDED,
    currency: Currency.NGN,
    amount: d('60200'),
    chargedAmount: d('60200'),
    checkout: { subtotal: d('54000'), serviceFee: d('2700') },
    refunds: [],
    ...overrides,
  };
}

function refundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    paymentId: 'pay-1',
    orderId: null,
    amount: d('0'),
    status: RefundStatus.PENDING,
    reason: 'r',
    initiatedById: admin.id,
    providerRefundId: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RefundService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    payment: { findUniqueOrThrow: jest.fn() },
    order: { findFirst: jest.fn(), findMany: jest.fn() },
    payoutItem: { findFirst: jest.fn() },
    refund: { create: jest.fn() },
  };
  const database = {
    payment: { findUnique: jest.fn() },
    refund: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const paystack = { createRefund: jest.fn() };
  const service = new RefundService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    database.payment.findUnique.mockResolvedValue({ id: 'pay-1' });
    tx.payment.findUniqueOrThrow.mockResolvedValue(paid());
    tx.payoutItem.findFirst.mockResolvedValue(null);
    tx.order.findMany.mockResolvedValue([]);
    // Prisma's update returns the whole row, so keep what create stored.
    let stored = refundRow();
    tx.refund.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        stored = refundRow(data);
        return Promise.resolve(stored);
      },
    );
    database.refund.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...stored, ...data }),
    );
    database.refund.updateMany.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        stored = { ...stored, ...data };
        return Promise.resolve({ count: 1 });
      },
    );
    database.refund.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(stored),
    );
    paystack.createRefund.mockResolvedValue({ id: '3018284' });
  });

  describe('refund', () => {
    it("refunds a cancelled order's price plus its share of the service fee", async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'Farmer cancelled',
        }),
      ).resolves.toMatchObject({
        amount: '9450.00',
        status: RefundStatus.PENDING,
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payment:pay-1',
      );
      expect(tx.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-1', checkoutId: 'checkout-1' },
      });
      expect(paystack.createRefund).toHaveBeenCalledWith({
        reference: 'PAY-000001',
        amount: 945_000,
      });
      expect(database.refund.update).toHaveBeenCalledWith({
        where: { id: 'refund-1' },
        data: { providerRefundId: '3018284' },
      });
    });

    it('refunds a USD payment in proportion, rounded down', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({ currency: Currency.USD, chargedAmount: d('39.35') }),
      );
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      // 9450 / 60200 × 39.35 = 6.1770… → 6.17
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'r',
        }),
      ).resolves.toMatchObject({ amount: '6.17' });
    });

    it('refunds the remaining balance when no order is given', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [
            refundRow({ amount: d('9450'), status: RefundStatus.PROCESSED }),
            refundRow({ amount: d('500'), status: RefundStatus.FAILED }),
          ],
        }),
      );
      await expect(
        service.refund(admin, 'PAY-000001', { reason: 'Checkout cancelled' }),
      ).resolves.toMatchObject({ amount: '50750.00' });
    });

    it('never refunds past what was charged', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [refundRow({ amount: d('55000'), orderId: 'order-2' })],
        }),
      );
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      await expect(
        errorBody(
          service.refund(admin, 'PAY-000001', {
            orderId: 'order-1',
            reason: 'r',
          }),
        ),
      ).resolves.toMatchObject({ code: 'REFUND_EXCEEDS_BALANCE' });
      expect(tx.refund.create).not.toHaveBeenCalled();
    });

    it('refuses when nothing is left', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({ refunds: [refundRow({ amount: d('60200') })] }),
      );
      await expect(
        errorBody(service.refund(admin, 'PAY-000001', { reason: 'r' })),
      ).resolves.toMatchObject({ code: 'NOTHING_TO_REFUND' });
    });

    it.each([
      PaymentStatus.PENDING,
      PaymentStatus.FAILED,
      PaymentStatus.ABANDONED,
    ])('refuses a %s payment', async (status) => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(paid({ status }));
      await expect(
        errorBody(service.refund(admin, 'PAY-000001', { reason: 'r' })),
      ).resolves.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    it.each([
      ['missing', null],
      [
        'not cancelled',
        { id: 'order-1', status: OrderStatus.PENDING, totalPrice: d('1') },
      ],
    ])('refuses an order that is %s', async (_label, order) => {
      tx.order.findFirst.mockResolvedValue(order);
      await expect(
        errorBody(
          service.refund(admin, 'PAY-000001', {
            orderId: 'order-1',
            reason: 'r',
          }),
        ),
      ).resolves.toMatchObject({ code: 'ORDER_NOT_REFUNDABLE' });
    });

    it('refuses an order refunded already, but allows retrying a failed one', async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [refundRow({ orderId: 'order-1', amount: d('9450') })],
        }),
      );
      await expect(
        errorBody(
          service.refund(admin, 'PAY-000001', {
            orderId: 'order-1',
            reason: 'r',
          }),
        ),
      ).resolves.toMatchObject({ code: 'ORDER_ALREADY_REFUNDED' });

      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [
            refundRow({
              orderId: 'order-1',
              amount: d('9450'),
              status: RefundStatus.FAILED,
            }),
          ],
        }),
      );
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'r',
        }),
      ).resolves.toMatchObject({ amount: '9450.00' });
    });

    it('retries the refund of an orphan whose automatic refund failed', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          status: PaymentStatus.ORPHANED,
          refunds: [
            refundRow({
              amount: d('60200'),
              status: RefundStatus.FAILED,
              initiatedById: null,
            }),
          ],
        }),
      );
      await expect(
        service.refund(admin, 'PAY-000001', { reason: 'Retry' }),
      ).resolves.toMatchObject({
        amount: '60200.00',
        status: RefundStatus.PENDING,
      });
    });

    it("refuses an order refund on an orphan, whose orders weren't paid by it", async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({ status: PaymentStatus.ORPHANED }),
      );
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      await expect(
        errorBody(
          service.refund(admin, 'PAY-000001', {
            orderId: 'order-1',
            reason: 'r',
          }),
        ),
      ).resolves.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
      expect(tx.refund.create).not.toHaveBeenCalled();
    });

    it('refuses a whole refund once any order on the checkout is paid out', async () => {
      tx.payoutItem.findFirst.mockResolvedValue({ id: 'item-1' });
      await expect(
        errorBody(service.refund(admin, 'PAY-000001', { reason: 'r' })),
      ).resolves.toMatchObject({
        code: 'ORDERS_PAID_OUT',
        message: "Reverse this checkout's payouts before refunding it in full",
      });
      expect(tx.payoutItem.findFirst).toHaveBeenCalledWith({
        where: {
          order: { checkoutId: 'checkout-1' },
          status: { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] },
        },
        select: { id: true },
      });
      expect(tx.refund.create).not.toHaveBeenCalled();
    });

    it("takes the checkout farmers' payout locks, sorted, before checking for payouts", async () => {
      tx.order.findMany.mockResolvedValue([
        { farm: { ownerId: 'farmer-b' } },
        { farm: { ownerId: 'farmer-a' } },
        { farm: { ownerId: 'farmer-b' } },
      ]);
      const order: string[] = [];
      tx.$executeRaw.mockImplementation((_sql: unknown, key: string) => {
        order.push(key);
        return Promise.resolve(1);
      });
      tx.payoutItem.findFirst.mockImplementation(() => {
        order.push('payout check');
        return Promise.resolve(null);
      });
      await service.refund(admin, 'PAY-000001', { reason: 'r' });
      expect(tx.order.findMany).toHaveBeenCalledWith({
        where: { checkoutId: 'checkout-1' },
        select: { farm: { select: { ownerId: true } } },
      });
      expect(order).toEqual([
        'payment:pay-1',
        'payout:farmer:farmer-a',
        'payout:farmer:farmer-b',
        'payout check',
      ]);
    });

    it('takes no farmer locks for an order refund', async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
      });
      await service.refund(admin, 'PAY-000001', {
        orderId: 'order-1',
        reason: 'r',
      });
      expect(tx.order.findMany).not.toHaveBeenCalled();
    });

    it('records a refund Paystack refused as FAILED', async () => {
      paystack.createRefund.mockRejectedValue(
        new PaystackError('Transaction has been fully reversed', 400),
      );
      await expect(
        service.refund(admin, 'PAY-000001', { reason: 'r' }),
      ).resolves.toMatchObject({
        status: RefundStatus.FAILED,
        failureReason: 'Transaction has been fully reversed',
      });
      expect(database.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-1', status: RefundStatus.PENDING },
        data: {
          status: RefundStatus.FAILED,
          failureReason: 'Transaction has been fully reversed',
        },
      });
    });

    it.each([null, 502])(
      'leaves the refund PENDING when the outcome is unknown (%s)',
      async (httpStatus) => {
        paystack.createRefund.mockRejectedValue(
          new PaystackError('Unknown outcome', httpStatus),
        );
        await expect(
          service.refund(admin, 'PAY-000001', { reason: 'r' }),
        ).resolves.toMatchObject({ status: RefundStatus.PENDING });
        // No update at all: providerRefundId stays null and it isn't FAILED.
        expect(database.refund.updateMany).not.toHaveBeenCalled();
        expect(database.refund.update).not.toHaveBeenCalled();
      },
    );

    it('404s an unknown reference', async () => {
      database.payment.findUnique.mockResolvedValue(null);
      await expect(
        errorBody(service.refund(admin, 'PAY-999999', { reason: 'r' })),
      ).resolves.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    });
  });

  describe('applyResult', () => {
    it('marks the refund matched by id processed', async () => {
      database.refund.findFirst.mockResolvedValue(refundRow());
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: true,
        reason: null,
      });
      expect(database.refund.findFirst).toHaveBeenCalledWith({
        where: { providerRefundId: '3018284' },
      });
      expect(database.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-1', status: RefundStatus.PENDING },
        data: { status: RefundStatus.PROCESSED },
      });
    });

    it('falls back to the oldest pending refund on the transaction', async () => {
      database.refund.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(refundRow());
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: false,
        reason: 'Bank declined',
      });
      expect(database.refund.findFirst).toHaveBeenLastCalledWith({
        where: {
          status: RefundStatus.PENDING,
          payment: { reference: 'PAY-000001' },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(database.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-1', status: RefundStatus.PENDING },
        data: { status: RefundStatus.FAILED, failureReason: 'Bank declined' },
      });
    });

    it('never revives a FAILED refund, even when Paystack says it went out', async () => {
      database.refund.findFirst.mockResolvedValue(
        refundRow({ status: RefundStatus.FAILED }),
      );
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: true,
        reason: null,
      });
      expect(database.refund.updateMany).not.toHaveBeenCalled();
      expect(database.refund.update).not.toHaveBeenCalled();
    });

    it('ignores a result for no known refund', async () => {
      database.refund.findFirst.mockResolvedValue(null);
      await service.applyResult({
        providerRefundId: null,
        transactionReference: 'PAY-999999',
        processed: true,
        reason: null,
      });
      expect(database.refund.updateMany).not.toHaveBeenCalled();
    });
  });
});
