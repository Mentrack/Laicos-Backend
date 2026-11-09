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
import {
  eligibleItems,
  keptShare,
  payoutAmount,
  reversalCleared,
} from '../utils/eligibility';

const d = (value: string) => new Prisma.Decimal(value);
const now = new Date('2026-11-05T12:00:00Z');
const LIVE = { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] };
const accountPastHold = {
  bankAccount: { is: { payoutsHeldUntil: { lte: now } } },
};

// Shared by both kinds: fulfilled, paid, no whole-balance refund, and either
// past the hold with no dispute or resolved with the refund settled.
function common(kind: PayoutItemKind) {
  return {
    status: OrderStatus.FULFILLED,
    checkout: {
      is: {
        status: CheckoutStatus.PAID,
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
    payoutItems: { none: { kind, status: LIVE } },
    OR: [
      {
        dispute: { is: null },
        fulfilledAt: { lte: new Date('2026-11-04T12:00:00Z') },
      },
      { dispute: { is: { status: DisputeStatus.RESOLVED, refundPercent: 0 } } },
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
  };
}

describe('eligibleItems', () => {
  it('pays the farm owner the produce price once their account hold is over', () => {
    expect(eligibleItems(now, 24, PayoutItemKind.PRODUCE)).toEqual({
      ...common(PayoutItemKind.PRODUCE),
      totalPrice: { gt: 0 },
      farm: { owner: { user: accountPastHold } },
    });
  });

  it('pays the handover agent the commission, and only when there is one', () => {
    expect(eligibleItems(now, 24, PayoutItemKind.COMMISSION)).toEqual({
      ...common(PayoutItemKind.COMMISSION),
      agentCommission: { gt: 0 },
      handover: { is: { agent: { is: { user: accountPastHold } } } },
    });
  });

  it('never lets an OPEN dispute through: every branch needs none or RESOLVED', () => {
    const where = eligibleItems(now, 24, PayoutItemKind.PRODUCE);
    const branches = where.OR as Prisma.OrderWhereInput[];
    for (const branch of branches) {
      const dispute = branch.dispute as { is: { status?: string } | null };
      expect(dispute.is === null || dispute.is.status === 'RESOLVED').toBe(
        true,
      );
    }
  });

  it('only the no-dispute branch waits out the hold', () => {
    const branches = eligibleItems(now, 24, PayoutItemKind.PRODUCE)
      .OR as Prisma.OrderWhereInput[];
    expect(branches.filter((branch) => branch.fulfilledAt)).toEqual([
      branches[0],
    ]);
  });

  it('a zero hold makes a just-confirmed order eligible', () => {
    const branches = eligibleItems(now, 0, PayoutItemKind.PRODUCE)
      .OR as Prisma.OrderWhereInput[];
    expect(branches[0].fulfilledAt).toEqual({ lte: now });
  });
});

describe('keptShare', () => {
  it('keeps everything with no dispute', () => {
    expect(keptShare(null).toString()).toBe('1');
  });

  it('keeps everything when the dispute was solved without a refund', () => {
    expect(
      keptShare({
        status: DisputeStatus.RESOLVED,
        refundPercent: d('0'),
      }).toString(),
    ).toBe('1');
  });

  it('keeps what the buyer was not refunded', () => {
    expect(
      keptShare({
        status: DisputeStatus.RESOLVED,
        refundPercent: d('30'),
      }).toString(),
    ).toBe('0.7');
  });
});

describe('payoutAmount', () => {
  const order = { totalPrice: d('1000.00'), agentCommission: d('50.00') };

  it('pays the produce price and the commission at the kept share', () => {
    expect(
      payoutAmount(order, PayoutItemKind.PRODUCE, d('0.7')).toFixed(2),
    ).toBe('700.00');
    expect(
      payoutAmount(order, PayoutItemKind.COMMISSION, d('0.7')).toFixed(2),
    ).toBe('35.00');
  });

  it('rounds down, in Laicos’ favour', () => {
    const odd = { totalPrice: d('10.05'), agentCommission: d('0.55') };
    expect(
      payoutAmount(odd, PayoutItemKind.PRODUCE, d('0.33')).toFixed(2),
    ).toBe('3.31');
    expect(
      payoutAmount(odd, PayoutItemKind.COMMISSION, d('0.33')).toFixed(2),
    ).toBe('0.18');
  });

  it('is zero after a full refund', () => {
    expect(payoutAmount(order, PayoutItemKind.PRODUCE, d('0')).isZero()).toBe(
      true,
    );
  });
});

describe('reversalCleared', () => {
  const reversedAt = new Date('2026-11-01T00:00:00Z');

  it('retries an order never reversed (a FAILED item is never passed in)', () => {
    expect(reversalCleared([], reversedAt)).toBe(true);
  });

  it('holds a reversed order until the payee changes their account', () => {
    expect(reversalCleared([reversedAt], reversedAt)).toBe(false);
    expect(
      reversalCleared([reversedAt], new Date('2026-10-30T00:00:00Z')),
    ).toBe(false);
  });

  it('retries once the account changed after the reversal', () => {
    expect(
      reversalCleared([reversedAt], new Date('2026-11-02T00:00:00Z')),
    ).toBe(true);
  });

  it('needs the change to postdate every reversal', () => {
    expect(
      reversalCleared(
        [reversedAt, new Date('2026-11-03T00:00:00Z')],
        new Date('2026-11-02T00:00:00Z'),
      ),
    ).toBe(false);
  });
});
