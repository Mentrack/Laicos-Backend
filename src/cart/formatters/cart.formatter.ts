import { Prisma } from '../../../generated/client';
import { linePrice } from '../../order/utils/reservation';
import type { CartDto, CartItemDto } from '../dto';
import { cartItemIssue } from '../utils/cart-issue';

export const CART_ITEM_INCLUDE = {
  produce: {
    include: {
      farm: {
        select: { id: true, farmCode: true, verificationStatus: true },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

export type CartItemRow = Prisma.CartItemGetPayload<{
  include: typeof CART_ITEM_INCLUDE;
}>;

export function formatCartItem(item: CartItemRow): CartItemDto {
  const { produce } = item;
  return {
    id: item.id,
    quantity: item.quantity,
    lineTotal: linePrice(produce.pricePerUnit, item.quantity).toFixed(2),
    issue: cartItemIssue(item),
    produce: {
      id: produce.id,
      name: produce.name,
      imageUrl: produce.imageUrl,
      unit: produce.unit,
      pricePerUnit: produce.pricePerUnit.toFixed(2),
      floatingQuantity: produce.floatingQuantity,
      status: produce.status,
      farm: { id: produce.farm.id, farmCode: produce.farm.farmCode },
    },
  };
}

export function formatCart(
  items: CartItemRow[],
  deliveryFee: Prisma.Decimal,
): CartDto {
  const orderable = items.filter((item) => cartItemIssue(item) === null);
  const total = orderable.reduce(
    (sum, item) => sum.add(linePrice(item.produce.pricePerUnit, item.quantity)),
    new Prisma.Decimal(0),
  );
  const fee = orderable.length > 0 ? deliveryFee : new Prisma.Decimal(0);
  return {
    items: items.map(formatCartItem),
    itemCount: items.length,
    total: total.toFixed(2),
    deliveryFee: fee.toFixed(2),
    grandTotal: total.add(fee).toFixed(2),
  };
}
