import { Prisma } from '../../../generated/client';
import { fromDateColumn } from '../../common/dates';

export const CHECKOUT_INCLUDE = {
  orders: { orderBy: { orderNumber: 'asc' } },
} satisfies Prisma.CheckoutInclude;

export type CheckoutRow = Prisma.CheckoutGetPayload<{
  include: typeof CHECKOUT_INCLUDE;
}>;

export function formatCheckout(checkout: CheckoutRow) {
  return {
    id: checkout.id,
    checkoutNumber: checkout.checkoutNumber,
    buyerId: checkout.buyerId,
    status: checkout.status,
    subtotal: checkout.subtotal.toFixed(2),
    deliveryFee: checkout.deliveryFee.toFixed(2),
    totalPrice: checkout.totalPrice.toFixed(2),
    expiresAt: checkout.expiresAt,
    paidAt: checkout.paidAt,
    deliveryDate: fromDateColumn(checkout.deliveryDate),
    shippingTo: {
      label: checkout.deliveryLabel,
      street: checkout.deliveryStreet,
      state: checkout.deliveryState,
      lga: checkout.deliveryLga,
      contactName: checkout.deliveryContactName,
      contactPhone: checkout.deliveryContactPhone,
    },
    createdAt: checkout.createdAt,
    orders: checkout.orders,
  };
}
