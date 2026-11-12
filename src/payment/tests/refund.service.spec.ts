import { HttpException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Currency,
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  RefundStatus,
  Role,
  type Payment,
  type User,
} from '../../../generated/client';
import { proportionalShare } from '../../common/money';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundService } from '../refund.service';

const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const d = (value: string) => new Prisma.Decimal(value);

type OrderRef = { id: string; orderNumber: string; farmId: string };
const order1: OrderRef = {
  id: 'order-1',
  orderNumber: 'ORD-000001',
  farmId: 'farm-1',
};
const order2: OrderRef = {
  id: 'order-2',
  orderNumber: 'ORD-000002',
  farmId: 'farm-2',
};

function refundEvent(
  order: OrderRef,
  title: string,
  summary: string,
  actor: { type: AuditActorType; userId: string | null },
) {
  return {
    actorType: actor.type,
    actorUserId: actor.userId,
    farmerId: null,
    agentId: null,
    farmId: order.farmId,
    category: AuditCategory.PAYOUT,
    title,
    summary,
    actionLabel: 'View order',
    resource: AuditResource.ORDER,
    resourceId: order.id,
    sourcingRequestId: null,
    orderId: order.id,
  };
}
const adminActor = { type: AuditActorType.ADMIN, userId: 'admin-1' };
const systemActor = { type: AuditActorType.SYSTEM, userId: null };

// The checkout's orders, as refundOrderIds() reads them; lockPayees() also
// calls findMany and keeps getting an empty list.
function checkoutOrders(orders: OrderRef[]) {
  return ({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve('checkout' in where ? orders : []);
}
const REFUND_ORDER_SELECT = { id: true, orderNumber: true, farmId: true };

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

// A ₦62,900 checkout (54,000 items + 3,500 delivery + 2,700 service fee + 2,700 agent commission).
function paid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    reference: 'PAY-000001',
    checkoutId: 'checkout-1',
    status: PaymentStatus.SUCCEEDED,
    currency: Currency.NGN,
    amount: d('62900'),
    chargedAmount: d('62900'),
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
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    payoutItem: { findFirst: jest.fn() },
    refund: { create: jest.fn(), updateMany: jest.fn() },
    auditEvent: { createMany: jest.fn() },
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
  const notification = { notify: jest.fn(), dispatch: jest.fn() };
  const service = new RefundService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
    notification as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    database.payment.findUnique.mockResolvedValue({ id: 'pay-1' });
    tx.payment.findUniqueOrThrow.mockResolvedValue(paid());
    tx.payoutItem.findFirst.mockResolvedValue(null);
    tx.order.findMany.mockResolvedValue([]);
    tx.order.findUniqueOrThrow.mockResolvedValue(order1);
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
    tx.refund.updateMany.mockImplementation(
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
    it("records an order refund on that order's timeline, as the admin", async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
        agentCommission: d('450'),
      });
      await service.refund(admin, 'PAY-000001', {
        orderId: 'order-1',
        reason: 'Farmer cancelled',
      });
      expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(1);
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [refundEvent(order1, 'Refund issued', '9900.00', adminActor)],
      });
      expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        select: REFUND_ORDER_SELECT,
      });
    });

    it('records a checkout refund on each order of the checkout', async () => {
      tx.order.findMany.mockImplementation(checkoutOrders([order1, order2]));
      await service.refund(admin, 'PAY-000001', { reason: 'Buyer cancelled' });
      expect(tx.order.findMany).toHaveBeenCalledWith({
        where: { checkout: { payments: { some: { id: 'pay-1' } } } },
        select: REFUND_ORDER_SELECT,
      });
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [
          refundEvent(order1, 'Refund issued', '62900.00', adminActor),
          refundEvent(order2, 'Refund issued', '62900.00', adminActor),
        ],
      });
    });

    it("refunds a cancelled order's price plus its share of the service fee", async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
        agentCommission: d('450'),
      });
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'Farmer cancelled',
        }),
      ).resolves.toMatchObject({
        amount: '9900.00',
        status: RefundStatus.PENDING,
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payment:pay-1',
      );
      expect(tx.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-1', checkoutId: 'checkout-1' },
        include: { dispute: true },
      });
      expect(paystack.createRefund).toHaveBeenCalledWith({
        reference: 'PAY-000001',
        amount: 990_000,
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
        agentCommission: d('450'),
      });
      // 9900 / 62900 × 39.35 = 6.1936… → 6.19
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'r',
        }),
      ).resolves.toMatchObject({ amount: '6.19' });
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
      ).resolves.toMatchObject({ amount: '53450.00' });
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
        agentCommission: d('450'),
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
        paid({ refunds: [refundRow({ amount: d('62900') })] }),
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
        agentCommission: d('450'),
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
      ).resolves.toMatchObject({ amount: '9900.00' });
    });

    it('retries the refund of an orphan whose automatic refund failed', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          status: PaymentStatus.ORPHANED,
          refunds: [
            refundRow({
              amount: d('62900'),
              status: RefundStatus.FAILED,
              initiatedById: null,
            }),
          ],
        }),
      );
      await expect(
        service.refund(admin, 'PAY-000001', { reason: 'Retry' }),
      ).resolves.toMatchObject({
        amount: '62900.00',
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
        agentCommission: d('450'),
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

    it("takes the checkout's farmer and agent payout locks, sorted, before checking for payouts", async () => {
      tx.order.findMany.mockResolvedValue([
        {
          farm: { owner: { userId: 'user-c' } },
          handover: { agent: { userId: 'user-a' } },
        },
        { farm: { owner: { userId: 'user-b' } }, handover: null },
        {
          farm: { owner: { userId: 'user-c' } },
          handover: { agent: null },
        },
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
        select: {
          farm: { select: { owner: { select: { userId: true } } } },
          handover: { select: { agent: { select: { userId: true } } } },
        },
      });
      expect(order).toEqual([
        'payment:pay-1',
        'payout:user:user-a',
        'payout:user:user-b',
        'payout:user:user-c',
        'payout check',
      ]);
    });

    it('takes no farmer locks for an order refund', async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
        agentCommission: d('450'),
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
      expect(tx.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-1', status: RefundStatus.PENDING },
        data: {
          status: RefundStatus.FAILED,
          failureReason: 'Transaction has been fully reversed',
        },
      });
    });

    it("records a refund Paystack refused on the order's timeline, as the system", async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
        agentCommission: d('450'),
      });
      paystack.createRefund.mockRejectedValue(
        new PaystackError('Transaction has been fully reversed', 400),
      );
      await service.refund(admin, 'PAY-000001', {
        orderId: 'order-1',
        reason: 'r',
      });
      expect(tx.auditEvent.createMany).toHaveBeenLastCalledWith({
        data: [refundEvent(order1, 'Refund failed', '9900.00', systemActor)],
      });
    });

    it('records no failure when the webhook settled the refund first', async () => {
      tx.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        totalPrice: d('9000'),
        agentCommission: d('450'),
      });
      paystack.createRefund.mockRejectedValue(
        new PaystackError('Transaction has been fully reversed', 400),
      );
      tx.refund.updateMany.mockResolvedValue({ count: 0 });
      await service.refund(admin, 'PAY-000001', {
        orderId: 'order-1',
        reason: 'r',
      });
      // Only the Refund issued event.
      expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(1);
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [refundEvent(order1, 'Refund issued', '9900.00', adminActor)],
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
        expect(tx.refund.updateMany).not.toHaveBeenCalled();
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

  describe('re-issuing a dispute refund', () => {
    const disputed = (refundPercent: string) => ({
      id: 'order-1',
      status: OrderStatus.FULFILLED,
      totalPrice: d('9000'),
      agentCommission: d('450'),
      dispute: {
        id: 'dispute-1',
        status: DisputeStatus.RESOLVED,
        refundPercent: d(refundPercent),
      },
    });

    it("after the dispute's refund failed, creates a new one for the same amount", async () => {
      tx.order.findFirst.mockResolvedValue(disputed('30'));
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [
            refundRow({
              orderId: 'order-1',
              disputeId: 'dispute-1',
              amount: d('2970'),
              status: RefundStatus.FAILED,
            }),
          ],
        }),
      );
      await expect(
        service.refund(admin, 'PAY-000001', {
          orderId: 'order-1',
          reason: 'Re-issue',
        }),
      ).resolves.toMatchObject({ amount: '2970.00' });
      expect(tx.refund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          disputeId: 'dispute-1',
          amount: d('2970'),
        }) as unknown,
      });
    });

    it('still refuses while the dispute refund is pending', async () => {
      tx.order.findFirst.mockResolvedValue(disputed('30'));
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        paid({
          refunds: [
            refundRow({
              orderId: 'order-1',
              disputeId: 'dispute-1',
              amount: d('2970'),
            }),
          ],
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
    });

    it('refuses a dispute solved without a refund', async () => {
      tx.order.findFirst.mockResolvedValue(disputed('0'));
      await expect(
        errorBody(
          service.refund(admin, 'PAY-000001', {
            orderId: 'order-1',
            reason: 'r',
          }),
        ),
      ).resolves.toMatchObject({ code: 'ORDER_NOT_REFUNDABLE' });
    });

    it('a cancelled order has no dispute link', async () => {
      tx.order.findFirst.mockResolvedValue({
        ...disputed('30'),
        status: OrderStatus.CANCELLED,
        dispute: null,
      });
      await service.refund(admin, 'PAY-000001', {
        orderId: 'order-1',
        reason: 'r',
      });
      expect(tx.refund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ disputeId: null }) as unknown,
      });
    });
  });

  describe('createForDispute', () => {
    const order = {
      id: 'order-1',
      orderNumber: 'ORD-000001',
      totalPrice: d('9000'),
      agentCommission: d('450'),
    };
    const dispute = (refundPercent: string) => ({
      id: 'dispute-1',
      refundPercent: d(refundPercent),
      resolutionNote: 'Partly spoiled',
    });

    it('refunds the percent of what the buyer paid, rounded down', async () => {
      // Paid 9001 + 450 + 450.05 = 9901.05; × 33.33% = 3300.0199… → 3300.01
      const refund = await service.createForDispute(
        tx as unknown as Prisma.TransactionClient,
        paid(),
        { ...order, totalPrice: d('9001') },
        dispute('33.33'),
        admin,
      );
      expect(refund.amount).toEqual(d('3300.01'));
      expect(tx.refund.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'pay-1',
          orderId: 'order-1',
          disputeId: 'dispute-1',
          amount: d('3300.01'),
          reason: 'Partly spoiled',
          initiatedById: admin.id,
        },
      });
    });

    it('converts a USD payment in proportion, after rounding the naira down', async () => {
      // 9900 × 30% = 2970; 2970 × 39.35 / 62900 = 1.8580… → 1.85
      const refund = await service.createForDispute(
        tx as unknown as Prisma.TransactionClient,
        paid({ currency: Currency.USD, chargedAmount: d('39.35') }),
        order,
        dispute('30'),
        admin,
      );
      expect(refund.amount).toEqual(
        proportionalShare(d('2970'), d('62900'), d('39.35')),
      );
      expect(refund.amount).toEqual(d('1.85'));
    });

    it("records the refund on the disputed order's timeline, as the admin", async () => {
      await service.createForDispute(
        tx as unknown as Prisma.TransactionClient,
        paid(),
        order,
        dispute('30'),
        admin,
      );
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [refundEvent(order1, 'Refund issued', '2970.00', adminActor)],
      });
    });

    it('refuses more than is left on the payment', async () => {
      await expect(
        errorBody(
          service.createForDispute(
            tx as unknown as Prisma.TransactionClient,
            paid({
              refunds: [
                refundRow({
                  amount: d('61000'),
                  status: RefundStatus.PROCESSED,
                }),
              ],
            }),
            order,
            dispute('30'),
            admin,
          ),
        ),
      ).resolves.toMatchObject({ code: 'REFUND_EXCEEDS_BALANCE' });
      expect(tx.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('createAutomatic', () => {
    it("records the refund on each of the checkout's orders, as the system", async () => {
      tx.order.findMany.mockImplementation(checkoutOrders([order1, order2]));
      await service.createAutomatic(
        tx as unknown as Prisma.TransactionClient,
        paid({ status: PaymentStatus.ORPHANED }) as unknown as Payment,
        'Checkout expired before payment',
      );
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [
          refundEvent(order1, 'Refund issued', '62900.00', systemActor),
          refundEvent(order2, 'Refund issued', '62900.00', systemActor),
        ],
      });
    });
  });

  describe('applyResult', () => {
    beforeEach(() => {
      tx.refund.updateMany.mockResolvedValue({ count: 1 });
      tx.payment.findUniqueOrThrow.mockResolvedValue({
        currency: Currency.NGN,
        checkout: { buyer: { userId: 'buyer-user-1' } },
      });
      notification.notify.mockResolvedValue(['delivery-1']);
    });

    it('tells the buyer a processed refund went out, dispatching after commit', async () => {
      database.refund.findFirst.mockResolvedValue(
        refundRow({ amount: d('1500') }),
      );
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: true,
        reason: null,
      });
      expect(notification.notify).toHaveBeenCalledWith(
        {
          userIds: ['buyer-user-1'],
          type: 'REFUND_PROCESSED',
          params: {
            refundId: 'refund-1',
            amount: '1500.00',
            currency: Currency.NGN,
          },
        },
        tx,
      );
      expect(notification.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('does not notify for a failed result', async () => {
      database.refund.findFirst.mockResolvedValue(refundRow());
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: false,
        reason: 'Bank declined',
      });
      expect(notification.notify).not.toHaveBeenCalled();
      expect(notification.dispatch.mock.calls.flat(2)).toEqual([]);
    });

    it('does not notify when another webhook settled it first', async () => {
      database.refund.findFirst.mockResolvedValue(refundRow());
      tx.refund.updateMany.mockResolvedValue({ count: 0 });
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: true,
        reason: null,
      });
      expect(notification.notify).not.toHaveBeenCalled();
      expect(tx.auditEvent.createMany).not.toHaveBeenCalled();
    });

    it('records a processed refund on its order, as the system', async () => {
      database.refund.findFirst.mockResolvedValue(
        refundRow({ orderId: 'order-1', amount: d('1500') }),
      );
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: true,
        reason: null,
      });
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [refundEvent(order1, 'Refund processed', '1500.00', systemActor)],
      });
    });

    it("records a failed checkout refund on each of the checkout's orders", async () => {
      database.refund.findFirst.mockResolvedValue(
        refundRow({ amount: d('1500') }),
      );
      tx.order.findMany.mockImplementation(checkoutOrders([order1, order2]));
      await service.applyResult({
        providerRefundId: '3018284',
        transactionReference: 'PAY-000001',
        processed: false,
        reason: 'Bank declined',
      });
      expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
        data: [
          refundEvent(order1, 'Refund failed', '1500.00', systemActor),
          refundEvent(order2, 'Refund failed', '1500.00', systemActor),
        ],
      });
    });

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
      expect(tx.refund.updateMany).toHaveBeenCalledWith({
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
      expect(tx.refund.updateMany).toHaveBeenCalledWith({
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
      expect(tx.refund.updateMany).not.toHaveBeenCalled();
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
      expect(tx.refund.updateMany).not.toHaveBeenCalled();
    });
  });
});
