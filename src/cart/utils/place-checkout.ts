import { BadRequestException, ConflictException } from '@nestjs/common';
import { CheckoutStatus, OrderStatus, Prisma } from '../../../generated/client';
import { addressNotFound } from '../../address/utils/address-not-found';
import { addDays, lagosToday, toDateColumn } from '../../common/dates';
import type { OrderLine } from '../../order/utils/reservation';
import type { CheckoutConfig } from '../../payment/checkout-config';
import {
  CHECKOUT_INCLUDE,
  type CheckoutRow,
} from '../formatters/checkout.formatter';

export type DeliverySnapshot = {
  deliveryDate: Date;
  deliveryLabel: string;
  deliveryStreet: string;
  deliveryState: string;
  deliveryLga: string;
  deliveryContactName: string | null;
  deliveryContactPhone: string | null;
};

export type CheckoutDraft = {
  buyerId: string;
  idempotencyKey: string;
  lines: OrderLine[];
  delivery: DeliverySnapshot;
  expectedTotal: number;
};

export function findReplay(
  tx: Prisma.TransactionClient,
  buyerId: string,
  idempotencyKey: string,
): Promise<CheckoutRow | null> {
  return tx.checkout.findUnique({
    where: { buyerId_idempotencyKey: { buyerId, idempotencyKey } },
    include: CHECKOUT_INCLUDE,
  });
}

/**
 * The buyer's address and date as the checkout stores them. Callers run it
 * before reserving, so a bad address or date fails before any row is locked.
 */
export async function resolveDelivery(
  tx: Prisma.TransactionClient,
  buyerId: string,
  addressId: string,
  deliveryDate: string,
  config: CheckoutConfig,
  now: Date = new Date(),
): Promise<DeliverySnapshot> {
  const address = await tx.address.findFirst({
    where: { id: addressId, buyerId },
    include: { state: true, lga: true },
  });
  if (!address) {
    throw addressNotFound();
  }
  const today = lagosToday(now);
  const earliest = addDays(today, config.deliveryMinDays);
  const latest = addDays(today, config.deliveryMaxDays);
  if (deliveryDate < earliest || deliveryDate > latest) {
    throw new BadRequestException({
      message: `Delivery date must be between ${earliest} and ${latest}`,
      code: 'INVALID_DELIVERY_DATE',
    });
  }
  return {
    deliveryDate: toDateColumn(deliveryDate),
    deliveryLabel: address.label,
    deliveryStreet: address.street,
    deliveryState: address.state.name,
    deliveryLga: address.lga.name,
    deliveryContactName: address.contactName,
    deliveryContactPhone: address.contactPhone,
  };
}

/**
 * Prices the reserved lines plus delivery and places them awaiting payment.
 * The lines must come from rows the caller has just reserved (and so
 * locked), so a farmer's price edit can't slip in after the check.
 */
export async function createCheckout(
  tx: Prisma.TransactionClient,
  draft: CheckoutDraft,
  config: CheckoutConfig,
  now: Date = new Date(),
): Promise<CheckoutRow> {
  const subtotal = draft.lines.reduce(
    (sum, line) => sum.add(line.totalPrice),
    new Prisma.Decimal(0),
  );
  const totalPrice = subtotal.add(config.deliveryFee);
  if (!totalPrice.equals(draft.expectedTotal)) {
    throw new ConflictException({
      message: 'Prices in your cart have changed',
      code: 'CART_PRICE_CHANGED',
    });
  }
  return tx.checkout.create({
    data: {
      buyerId: draft.buyerId,
      idempotencyKey: draft.idempotencyKey,
      status: CheckoutStatus.AWAITING_PAYMENT,
      subtotal,
      deliveryFee: config.deliveryFee,
      totalPrice,
      expiresAt: new Date(now.getTime() + config.holdMinutes * 60_000),
      ...draft.delivery,
      orders: {
        create: draft.lines.map((line) => ({
          ...line,
          buyerId: draft.buyerId,
          status: OrderStatus.AWAITING_PAYMENT,
        })),
      },
    },
    include: CHECKOUT_INCLUDE,
  });
}
