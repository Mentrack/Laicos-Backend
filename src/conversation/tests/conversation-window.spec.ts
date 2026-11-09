import { DisputeStatus, OrderStatus } from '../../../generated/client';
import { disputeWindowOpen } from '../../payout/utils/dispute-window';
import { isClosed } from '../utils/conversation-window';

const now = new Date('2026-11-05T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe('disputeWindowOpen', () => {
  it('is open until the hold has passed', () => {
    expect(disputeWindowOpen(hoursAgo(23), 24, now)).toBe(true);
    expect(disputeWindowOpen(hoursAgo(24), 24, now)).toBe(false);
  });
});

describe('isClosed', () => {
  const fulfilled = (
    hours: number,
    dispute: { status: DisputeStatus } | null = null,
  ) => ({
    status: OrderStatus.FULFILLED,
    fulfilledAt: hoursAgo(hours),
    dispute,
  });

  it('stays open inside the dispute window', () => {
    expect(isClosed(fulfilled(1), 24, now)).toBe(false);
  });

  it('closes once the window passes with no dispute', () => {
    expect(isClosed(fulfilled(25), 24, now)).toBe(true);
  });

  it('stays open while a dispute is OPEN', () => {
    expect(
      isClosed(fulfilled(25, { status: DisputeStatus.OPEN }), 24, now),
    ).toBe(false);
  });

  it('closes once the dispute is RESOLVED', () => {
    expect(
      isClosed(fulfilled(1, { status: DisputeStatus.RESOLVED }), 24, now),
    ).toBe(true);
  });

  it('closes a cancelled order', () => {
    expect(
      isClosed(
        { status: OrderStatus.CANCELLED, fulfilledAt: null, dispute: null },
        24,
        now,
      ),
    ).toBe(true);
  });

  it('keeps a shipped order open', () => {
    expect(
      isClosed(
        { status: OrderStatus.SHIPPED, fulfilledAt: null, dispute: null },
        24,
        now,
      ),
    ).toBe(false);
  });
});
