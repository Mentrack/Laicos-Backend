import {
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
  };
  const client = tx as unknown as Prisma.TransactionClient;
  const unpaid = (produceId: string) => ({
    id: `order-${produceId}`,
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
});
