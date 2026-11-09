import {
  DisputeStatus,
  OrderStatus,
  type Order,
} from '../../../generated/client';
import { disputeWindowOpen } from '../../payout/utils/dispute-window';

type WindowOrder = Pick<Order, 'status' | 'fulfilledAt'> & {
  dispute: { status: DisputeStatus } | null;
};

/**
 * A closed order's conversation stays readable but takes no new messages. A
 * fulfilled order stays writable through the dispute window and while a
 * dispute is open, so buyer and agent can sort it out.
 */
export function isClosed(
  order: WindowOrder,
  holdHours: number,
  now: Date,
): boolean {
  if (order.status === OrderStatus.CANCELLED) {
    return true;
  }
  if (order.status !== OrderStatus.FULFILLED) {
    return false;
  }
  if (order.dispute) {
    return order.dispute.status === DisputeStatus.RESOLVED;
  }
  // fulfilledAt is always set with FULFILLED; a null here reads as expired.
  return (
    !order.fulfilledAt || !disputeWindowOpen(order.fulfilledAt, holdHours, now)
  );
}
