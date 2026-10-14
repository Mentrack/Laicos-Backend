import { OrderStatus } from '../../../generated/client';

const CLOSED: OrderStatus[] = [OrderStatus.FULFILLED, OrderStatus.CANCELLED];

/** A closed order's conversation stays readable but takes no new messages. */
export function isClosed(status: OrderStatus): boolean {
  return CLOSED.includes(status);
}
