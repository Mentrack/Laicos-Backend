import { Prisma } from '../../../generated/client';
import { percentOf } from '../../common/money';
import { linePrice } from '../../order/utils/reservation';
import type { CheckoutConfig } from '../../payment/checkout-config';
import type {
  CartDto,
  CartItemDto,
  CartLineDto,
  CartQuoteDto,
  CartTotalsDto,
} from '../dto';
import { cartItemIssue } from '../utils/cart-issue';

export const CART_PRODUCE_INCLUDE = {
  farm: {
    select: { id: true, farmCode: true, verificationStatus: true },
  },
} satisfies Prisma.ProduceInclude;

export const CART_ITEM_INCLUDE = {
  produce: { include: CART_PRODUCE_INCLUDE },
} satisfies Prisma.CartItemInclude;

export type CartItemRow = Prisma.CartItemGetPayload<{
  include: typeof CART_ITEM_INCLUDE;
}>;

/** A cart row or a device-cart line: all pricing and issues need. */
export type CartLineRow = Pick<CartItemRow, 'quantity' | 'produce'>;

export function formatCartLine(line: CartLineRow): CartLineDto {
  const { produce } = line;
  return {
    quantity: line.quantity,
    lineTotal: linePrice(produce.pricePerUnit, line.quantity).toFixed(2),
    issue: cartItemIssue(line),
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

export function formatCartItem(item: CartItemRow): CartItemDto {
  return { id: item.id, ...formatCartLine(item) };
}

type CartFees = Pick<CheckoutConfig, 'deliveryFee' | 'serviceFeePercent'>;

export function formatCart(items: CartItemRow[], fees: CartFees): CartDto {
  return {
    items: items.map(formatCartItem),
    ...cartTotals(items, fees),
  };
}

export function formatCartQuote(
  lines: CartLineRow[],
  fees: CartFees,
): Omit<CartQuoteDto, 'unavailableProduceIds'> {
  return {
    items: lines.map(formatCartLine),
    ...cartTotals(lines, fees),
  };
}

function cartTotals(lines: CartLineRow[], fees: CartFees): CartTotalsDto {
  const orderable = lines.filter((line) => cartItemIssue(line) === null);
  const total = orderable.reduce(
    (sum, line) => sum.add(linePrice(line.produce.pricePerUnit, line.quantity)),
    new Prisma.Decimal(0),
  );
  const deliveryFee =
    orderable.length > 0 ? fees.deliveryFee : new Prisma.Decimal(0);
  const serviceFee = percentOf(total, fees.serviceFeePercent);
  return {
    itemCount: lines.length,
    total: total.toFixed(2),
    deliveryFee: deliveryFee.toFixed(2),
    serviceFee: serviceFee.toFixed(2),
    grandTotal: total.add(deliveryFee).add(serviceFee).toFixed(2),
  };
}
