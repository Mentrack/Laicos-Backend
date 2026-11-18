import {
  DisputeStatus,
  OrderStatus,
  SourcingRequestStatus,
  type Order,
  type Prisma,
  type SourcingRequest,
} from '../../../generated/client';
import { disputeWindowOpen } from '../../payout/utils/dispute-window';

export const WINDOW_ORDER_SELECT = {
  status: true,
  fulfilledAt: true,
  dispute: { select: { status: true } },
} satisfies Prisma.OrderSelect;

export type WindowOrder = Pick<Order, 'status' | 'fulfilledAt'> & {
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

/**
 * paidOrders are the orders of the request's PAID checkout; empty means not
 * paid yet. After payment the chat outlives the request's own status, so
 * dispute talk on any order still has a home.
 */
export function sourcingChatClosed(
  request: Pick<SourcingRequest, 'status'>,
  paidOrders: WindowOrder[],
  holdHours: number,
  now: Date,
): boolean {
  if (paidOrders.length === 0) {
    return request.status === SourcingRequestStatus.CLOSED;
  }
  return paidOrders.every((order) => isClosed(order, holdHours, now));
}
