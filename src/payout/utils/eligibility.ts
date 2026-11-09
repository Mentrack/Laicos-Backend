import {
  CheckoutStatus,
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  PayoutItemKind,
  PayoutStatus,
  Prisma,
  RefundStatus,
} from '../../../generated/client';

const HOUR_MS = 3_600_000;
export const LIVE_PAYOUT_STATUSES = [
  PayoutStatus.PENDING,
  PayoutStatus.SUCCEEDED,
];

// Where each kind's payee sits relative to the order.
const PAYEE: Record<
  PayoutItemKind,
  (user: Prisma.UserWhereInput) => Prisma.OrderWhereInput
> = {
  [PayoutItemKind.PRODUCE]: (user) => ({ farm: { owner: { user } } }),
  [PayoutItemKind.COMMISSION]: (user) => ({
    handover: { is: { agent: { is: { user } } } },
  }),
};

/**
 * Orders with an item of this kind due. Callers still drop orders a reversal
 * holds (reversalCleared) and items whose kept share rounds to zero.
 */
export function eligibleItems(
  now: Date,
  holdHours: number,
  kind: PayoutItemKind,
): Prisma.OrderWhereInput {
  return {
    status: OrderStatus.FULFILLED,
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
    // Only live items block: a failed or reversed one frees its order.
    payoutItems: { none: { kind, status: { in: LIVE_PAYOUT_STATUSES } } },
    OR: [
      {
        dispute: { is: null },
        fulfilledAt: { lte: new Date(now.getTime() - holdHours * HOUR_MS) },
      },
      // A resolution ends the window early.
      { dispute: { is: { status: DisputeStatus.RESOLVED, refundPercent: 0 } } },
      // A PENDING refund may still fail and be re-issued; paying against it
      // could pay the same money to the buyer and the payee.
      {
        dispute: {
          is: {
            status: DisputeStatus.RESOLVED,
            refundPercent: { lt: 100 },
            refunds: {
              some: { status: RefundStatus.PROCESSED },
              none: { status: RefundStatus.PENDING },
            },
          },
        },
      },
    ],
    ...(kind === PayoutItemKind.PRODUCE
      ? { totalPrice: { gt: 0 } }
      : { agentCommission: { gt: 0 } }),
    ...PAYEE[kind]({ bankAccount: { is: { payoutsHeldUntil: { lte: now } } } }),
  };
}

/** Narrows eligibleItems to one payee's orders. */
export function payeeIs(
  kind: PayoutItemKind,
  userId: string,
): Prisma.OrderWhereInput {
  return PAYEE[kind]({ id: userId });
}

/** The part of an order its payees keep after any dispute refund. */
export function keptShare(
  dispute: {
    status: DisputeStatus;
    refundPercent: Prisma.Decimal | null;
  } | null,
): Prisma.Decimal {
  const refunded = dispute?.refundPercent ?? new Prisma.Decimal(0);
  return new Prisma.Decimal(1).sub(refunded.div(100));
}

// Down, so payouts never exceed what the buyer was left paying.
export function payoutAmount(
  order: { totalPrice: Prisma.Decimal; agentCommission: Prisma.Decimal },
  kind: PayoutItemKind,
  kept: Prisma.Decimal,
): Prisma.Decimal {
  const base =
    kind === PayoutItemKind.PRODUCE ? order.totalPrice : order.agentCommission;
  return base.mul(kept).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
}

// A reversal usually means a bad account, so retrying before the payee
// changes it would only bounce again. Prisma can't compare columns across
// relations, which is why this isn't in eligibleItems.
export function reversalCleared(
  reversedAt: Date[],
  accountUpdatedAt: Date,
): boolean {
  return reversedAt.every((at) => accountUpdatedAt.getTime() > at.getTime());
}
