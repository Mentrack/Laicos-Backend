import {
  CheckoutStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
} from '../../../generated/client';
import { eligibleOrders } from '../utils/eligibility';

describe('eligibleOrders', () => {
  it('selects fulfilled, paid, unrefunded, unpaid-out orders of farmers whose account hold is over', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(eligibleOrders(now, 48)).toEqual({
      status: OrderStatus.FULFILLED,
      fulfilledAt: { lte: new Date('2026-10-10T12:00:00Z') },
      checkout: {
        is: {
          status: CheckoutStatus.PAID,
          payments: {
            none: {
              status: PaymentStatus.SUCCEEDED,
              refunds: {
                some: {
                  orderId: null,
                  status: {
                    in: [RefundStatus.PENDING, RefundStatus.PROCESSED],
                  },
                },
              },
            },
          },
        },
      },
      payoutItems: {
        none: {
          status: { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] },
        },
      },
      farm: {
        owner: { bankAccount: { is: { payoutsHeldUntil: { lte: now } } } },
      },
    });
  });
});
