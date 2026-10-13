import {
  CheckoutStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  type Prisma,
} from '../../../generated/client';

const HOUR_MS = 3_600_000;

/** Orders an admin may pay out now. */
export function eligibleOrders(
  now: Date,
  holdHours: number,
): Prisma.OrderWhereInput {
  return {
    status: OrderStatus.FULFILLED,
    fulfilledAt: { lte: new Date(now.getTime() - holdHours * HOUR_MS) },
    checkout: {
      is: {
        status: CheckoutStatus.PAID,
        // A whole-balance refund gives the buyer back the produce money, so
        // paying the farmer too would pay it out twice. Only the SUCCEEDED
        // payment counts: an orphan's automatic refund returns other money.
        payments: {
          none: {
            status: PaymentStatus.SUCCEEDED,
            refunds: {
              some: {
                orderId: null,
                status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSED] },
              },
            },
          },
        },
      },
    },
    // Only live payouts block: a failed or reversed one frees its orders.
    payoutItems: {
      none: { status: { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] } },
    },
    farm: {
      owner: { bankAccount: { is: { payoutsHeldUntil: { lte: now } } } },
    },
  };
}
