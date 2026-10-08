import {
  FarmVerificationStatus,
  ProduceStatus,
} from '../../../generated/client';
import {
  isOrderable,
  type ReservableProduce,
} from '../../order/utils/reservation';
import { CartItemIssue } from '../dto';
import type { CartItemRow } from '../formatters/cart.formatter';

/** Why checkout would refuse this item right now, or null if it wouldn't. */
export function cartItemIssue(item: CartItemRow): CartItemIssue | null {
  const { produce } = item;
  if (
    produce.status !== ProduceStatus.PUBLISHED ||
    produce.farm.verificationStatus !== FarmVerificationStatus.VERIFIED
  ) {
    return CartItemIssue.UNAVAILABLE;
  }
  if (item.quantity > produce.floatingQuantity) {
    return CartItemIssue.INSUFFICIENT_STOCK;
  }
  return null;
}

export function describeIssue(item: CartItemRow, issue: CartItemIssue): string {
  const { name, floatingQuantity, unit } = item.produce;
  return issue === CartItemIssue.UNAVAILABLE
    ? unavailable(name)
    : onlyAvailable(name, floatingQuantity, unit);
}

/**
 * Why a reservation failed, from the row as re-read after the attempt (null
 * once deleted). Named after the cart's snapshot, which survives a delete.
 */
export function describeLostReservation(
  name: string,
  produce: ReservableProduce | null,
): string {
  return produce && isOrderable(produce, 0)
    ? onlyAvailable(name, produce.floatingQuantity, produce.unit)
    : unavailable(name);
}

function unavailable(name: string) {
  return `${name}: no longer available`;
}

function onlyAvailable(name: string, quantity: number, unit: string) {
  return `${name}: only ${quantity} ${unit} available`;
}
