import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  OrderStatus,
  PaymentStatus,
  ProduceStatus,
  type Prisma,
} from '../../../generated/client';
import { releaseCheckout } from '../utils/release-checkout';

describe('releaseCheckout', () => {
  const tx = {
    order: { findMany: jest.fn(), updateMany: jest.fn() },
    produce: { update: jest.fn() },
    payment: { updateMany: jest.fn() },
    checkout: { update: jest.fn() },
    auditEvent: { createMany: jest.fn() },
  };
  const client = tx as unknown as Prisma.TransactionClient;
  const unpaid = (produceId: string) => ({
    id: `order-${produceId}`,
    orderNumber: `ORD-${produceId}`,
    farmId: `farm-${produceId}`,
    produceId,
    quantity: 3,
    status: OrderStatus.AWAITING_PAYMENT,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    tx.produce.update.mockResolvedValue({
      id: 'p',
      status: ProduceStatus.PUBLISHED,
      actualQuantity: 10,
      floatingQuantity: 10,
    });
    tx.checkout.update.mockResolvedValue({ id: 'checkout-1' });
  });

  it('returns stock, cancels the orders, abandons payments and sets the status', async () => {
    tx.order.findMany.mockResolvedValue([unpaid('a'), unpaid('b')]);
    await releaseCheckout(
      client,
      'checkout-1',
      CheckoutStatus.EXPIRED,
      'Payment not received',
      { type: AuditActorType.SYSTEM, userId: null },
    );
    expect(tx.order.findMany).toHaveBeenCalledWith({
      where: { checkoutId: 'checkout-1', status: OrderStatus.AWAITING_PAYMENT },
      orderBy: { produceId: 'asc' },
    });
    expect(tx.produce.update).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { checkoutId: 'checkout-1', status: OrderStatus.AWAITING_PAYMENT },
      data: {
        status: OrderStatus.CANCELLED,
        cancellationReason: 'Payment not received',
      },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { checkoutId: 'checkout-1', status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.ABANDONED },
    });
    expect(tx.checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'checkout-1' },
        data: { status: CheckoutStatus.EXPIRED },
      }),
    );
  });

  it('records one cancelled event per order, carrying the given actor', async () => {
    tx.order.findMany.mockResolvedValue([unpaid('a'), unpaid('b')]);
    tx.checkout.update.mockResolvedValue({
      id: 'checkout-1',
      sourcingRequestId: 'request-1',
    });
    await releaseCheckout(
      client,
      'checkout-1',
      CheckoutStatus.CANCELLED,
      'Cancelled by buyer',
      { type: AuditActorType.BUYER, userId: 'buyer-user-1' },
    );
    const cancelled = (id: string) => ({
      actorType: AuditActorType.BUYER,
      actorUserId: 'buyer-user-1',
      farmerId: null,
      agentId: null,
      farmId: `farm-${id}`,
      category: AuditCategory.ORDER,
      title: `Order ORD-${id} cancelled`,
      summary: 'Cancelled by buyer',
      actionLabel: 'View order',
      resource: AuditResource.ORDER,
      resourceId: `order-${id}`,
      sourcingRequestId: 'request-1',
      orderId: `order-${id}`,
    });
    expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
      data: [cancelled('a'), cancelled('b')],
    });
  });

  it('records nothing when no order was still unpaid', async () => {
    tx.order.findMany.mockResolvedValue([]);
    await releaseCheckout(
      client,
      'checkout-1',
      CheckoutStatus.EXPIRED,
      'Payment not received',
      { type: AuditActorType.SYSTEM, userId: null },
    );
    expect(tx.auditEvent.createMany).not.toHaveBeenCalled();
  });
});
