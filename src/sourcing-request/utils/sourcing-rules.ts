import {
  OrderStatus,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';

const UNIT_WORD: Record<SourcingUnit, string | null> = {
  [SourcingUnit.KG]: 'kg',
  [SourcingUnit.TONNES]: 'kg',
  [SourcingUnit.BAGS]: 'bags',
  [SourcingUnit.CRATES]: 'crates',
  [SourcingUnit.BASKETS]: 'baskets',
  [SourcingUnit.LITRES]: 'litres',
  [SourcingUnit.PIECES]: 'pieces',
};

export function unitsComparable(
  requestUnit: SourcingUnit,
  listingUnit: string,
): boolean {
  const word = UNIT_WORD[requestUnit];
  return word !== null && listingUnit.trim().toLowerCase() === word;
}

/** Whole kilograms for a weight request, otherwise the request's own number. */
export function requestedAmount(
  quantity: number,
  unit: SourcingUnit,
): number {
  if (unit === SourcingUnit.TONNES) {
    return Math.round(quantity * 1000);
  }
  if (unit === SourcingUnit.KG) {
    return Math.round(quantity);
  }
  return quantity;
}

export function coverage(requested: number, selected: number) {
  return {
    requested,
    selected,
    remaining: Math.max(0, requested - selected),
  };
}

export function namesMatch(requestName: string, listingName: string): boolean {
  return (
    requestName.trim().toLowerCase() === listingName.trim().toLowerCase()
  );
}

export type ListingCandidate = {
  statusPublished: boolean;
  floatingQuantity: number;
  listingName: string;
  requestName: string;
  farmVerified: boolean;
  inAgentCluster: boolean;
  requestUnit: SourcingUnit;
  listingUnit: string;
};

export function isListingEligible(candidate: ListingCandidate): boolean {
  return (
    candidate.statusPublished &&
    candidate.floatingQuantity >= 1 &&
    namesMatch(candidate.requestName, candidate.listingName) &&
    candidate.farmVerified &&
    candidate.inAgentCluster &&
    unitsComparable(candidate.requestUnit, candidate.listingUnit)
  );
}

export type SourcingSnapshot = {
  closedAt: Date | null;
  assignedAgentId: string | null;
  allocationCount: number;
  awaitingPayment: boolean;
  /** Null when no checkout is paid. Empty is not "all cancelled". */
  paidOrders: OrderStatus[] | null;
};

export function deriveSourcingStatus(
  snapshot: SourcingSnapshot,
): SourcingRequestStatus {
  const paid = snapshot.paidOrders;
  if (
    snapshot.closedAt ||
    (paid !== null &&
      paid.length > 0 &&
      paid.every((status) => status === OrderStatus.CANCELLED))
  ) {
    return SourcingRequestStatus.CLOSED;
  }
  if (
    paid !== null &&
    paid.some((status) => status === OrderStatus.FULFILLED) &&
    paid.every(
      (status) =>
        status === OrderStatus.FULFILLED || status === OrderStatus.CANCELLED,
    )
  ) {
    return SourcingRequestStatus.COMPLETED;
  }
  if (
    paid !== null &&
    paid.some(
      (status) =>
        status === OrderStatus.READY ||
        status === OrderStatus.SHIPPED ||
        status === OrderStatus.FULFILLED,
    )
  ) {
    return SourcingRequestStatus.FULFILMENT;
  }
  if (paid !== null) {
    return SourcingRequestStatus.CONFIRMED;
  }
  if (snapshot.awaitingPayment) {
    return SourcingRequestStatus.AWAITING_BUYER;
  }
  if (snapshot.allocationCount > 0) {
    return SourcingRequestStatus.FINDING_SUPPLY;
  }
  if (snapshot.assignedAgentId) {
    return SourcingRequestStatus.IN_REVIEW;
  }
  return SourcingRequestStatus.NEW;
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
