import { Prisma } from '../../../generated/client';
import { percentOf } from '../../common/money';

/** The only way commission is computed, so a line and its checkout sum agree. */
export function commissionFor(
  lineTotal: Prisma.Decimal,
  percent: Prisma.Decimal,
): Prisma.Decimal {
  return percentOf(lineTotal, percent);
}

/**
 * What the buyer paid for one order: its price, its commission and its share
 * of the service fee. Delivery is excluded because the rest of the checkout is
 * still delivered. Unrounded; callers round the final share.
 */
export function orderPaidAmount(
  order: { totalPrice: Prisma.Decimal; agentCommission: Prisma.Decimal },
  checkout: { serviceFee: Prisma.Decimal; subtotal: Prisma.Decimal },
): Prisma.Decimal {
  return order.totalPrice
    .add(order.agentCommission)
    .add(order.totalPrice.mul(checkout.serviceFee).div(checkout.subtotal));
}
