import { ConflictException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  OrderStatus,
  Prisma,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';

export const OPEN_SOURCING_REQUEST = {
  status: {
    notIn: [SourcingRequestStatus.FULFILLED, SourcingRequestStatus.CLOSED],
  },
} satisfies Prisma.SourcingRequestWhereInput;

const WEIGHT: SourcingUnit[] = [SourcingUnit.KG, SourcingUnit.TONNES];

/** Whether an offer in `offerUnit` can count towards a request in `requestUnit`. */
export function unitsComparable(
  requestUnit: SourcingUnit,
  offerUnit: SourcingUnit,
): boolean {
  return (
    requestUnit === offerUnit ||
    (WEIGHT.includes(requestUnit) && WEIGHT.includes(offerUnit))
  );
}

/** The free-text unit a hidden listing, notification or audit line shows. */
export function listingUnitWord(unit: SourcingUnit): string {
  return unit.toLowerCase();
}

/** Whole kilograms for a weight request, otherwise the request's own number. */
export function requestedAmount(quantity: number, unit: SourcingUnit): number {
  if (unit === SourcingUnit.TONNES) {
    return Math.round(quantity * 1000);
  }
  if (unit === SourcingUnit.KG) {
    return Math.round(quantity);
  }
  return quantity;
}

// Checked when offering and again at confirm, but not at the second
// signature: after confirm the agent can still go back and drop the farm.
export function requireVerifiedFarms(
  farms: { farmCode: string; verificationStatus: FarmVerificationStatus }[],
): void {
  const unverified = farms.filter(
    (farm) => farm.verificationStatus !== FarmVerificationStatus.VERIFIED,
  );
  if (unverified.length > 0) {
    throw new ConflictException({
      message: `Not a verified farm: ${unverified.map((farm) => farm.farmCode).join(', ')}`,
      code: 'SOURCING_FARM_UNVERIFIED',
    });
  }
}

export function fulfilmentMark(
  orders: { status: OrderStatus }[],
): 'IN_TRANSIT' | 'PENDING_PICKUP' | null {
  if (orders.some((order) => order.status === OrderStatus.SHIPPED)) {
    return 'IN_TRANSIT';
  }
  if (orders.some((order) => order.status === OrderStatus.READY)) {
    return 'PENDING_PICKUP';
  }
  return null;
}
