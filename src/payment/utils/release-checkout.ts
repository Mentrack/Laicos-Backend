import {
  OrderStatus,
  PaymentStatus,
  type CheckoutStatus,
  type Prisma,
} from '../../../generated/client';
import { CHECKOUT_INCLUDE } from '../../cart/formatters/checkout.formatter';
import { releaseStock } from '../../order/utils/reservation';

/**
 * Ends an unpaid checkout: its stock goes back, its orders are cancelled and
 * any payment in flight is abandoned. The caller holds the checkout lock and
 * has checked it is AWAITING_PAYMENT.
 */
export async function releaseCheckout(
  tx: Prisma.TransactionClient,
  checkoutId: string,
  status: CheckoutStatus,
  reason: string,
) {
  const unpaid = { checkoutId, status: OrderStatus.AWAITING_PAYMENT };
  // produceId order, like reservation, so a release and a checkout lock
  // shared produce rows in the same sequence.
  const orders = await tx.order.findMany({
    where: unpaid,
    orderBy: { produceId: 'asc' },
  });
  for (const order of orders) {
    await releaseStock(tx, order);
  }
  await tx.order.updateMany({
    where: unpaid,
    data: { status: OrderStatus.CANCELLED, cancellationReason: reason },
  });
  await tx.payment.updateMany({
    where: { checkoutId, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.ABANDONED },
  });
  return tx.checkout.update({
    where: { id: checkoutId },
    data: { status },
    include: CHECKOUT_INCLUDE,
  });
}
