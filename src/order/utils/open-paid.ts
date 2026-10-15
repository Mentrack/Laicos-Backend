import { OrderStatus } from '../../../generated/client';

/** Paid and not finished. Unpaid, cancelled and fulfilled orders are not open. */
export const OPEN_PAID_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SHIPPED,
];
