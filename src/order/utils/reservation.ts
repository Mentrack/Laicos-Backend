import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  type Farm,
  type Produce,
  type ProduceType,
} from '../../../generated/client';
import { deriveProduceStatus } from '../../produce/utils/produce-status';

export type ReservableProduce = Produce & {
  farm: Pick<Farm, 'verificationStatus'>;
};

export interface OrderLine {
  produceId: string;
  farmId: string;
  quantity: number;
  produceName: string;
  type: ProduceType;
  totalPrice: Prisma.Decimal;
}

/**
 * Takes `quantity` off the listing's floating stock, or throws why it can't.
 */
export async function reserveProduce(
  tx: Prisma.TransactionClient,
  produceId: string,
  quantity: number,
): Promise<ReservableProduce> {
  const { produce, reserved } = await tryReserveProduce(
    tx,
    produceId,
    quantity,
  );
  if (!reserved || !produce) {
    throw orderRefusal(produce);
  }
  return produce;
}

/**
 * The one conditional UPDATE both checks and reserves, so two buyers racing
 * for the last units can't both succeed. It also holds the row lock for the
 * rest of the caller's transaction, so the returned row's price and the
 * status sync need no extra guard. `produce` is the row as it stands after
 * the attempt (null if it no longer exists), so a caller can say why it failed.
 */
export async function tryReserveProduce(
  tx: Prisma.TransactionClient,
  produceId: string,
  quantity: number,
): Promise<{ produce: ReservableProduce | null; reserved: boolean }> {
  const { count } = await tx.produce.updateMany({
    where: {
      id: produceId,
      status: ProduceStatus.PUBLISHED,
      floatingQuantity: { gte: quantity },
      farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
    },
    data: { floatingQuantity: { decrement: quantity } },
  });
  const produce = await tx.produce.findUnique({
    where: { id: produceId },
    include: { farm: { select: { verificationStatus: true } } },
  });
  const reserved = count > 0 && produce !== null;
  if (reserved) {
    await syncProduceStatus(tx, produce);
  }
  return { produce, reserved };
}

/** The read-only twin of reserveProduce's WHERE, for cart feedback. */
export function isOrderable(
  produce: ReservableProduce | null,
  quantity: number,
): produce is ReservableProduce {
  return (
    !!produce &&
    produce.status === ProduceStatus.PUBLISHED &&
    produce.farm.verificationStatus === FarmVerificationStatus.VERIFIED &&
    produce.floatingQuantity >= quantity
  );
}

export function orderRefusal(produce: ReservableProduce | null) {
  // Drafts and unverified farms' listings are hidden, so ordering one reads
  // as not found.
  if (
    !produce ||
    produce.status === ProduceStatus.DRAFT ||
    produce.farm.verificationStatus !== FarmVerificationStatus.VERIFIED
  ) {
    return new NotFoundException('Produce not found');
  }
  if (produce.status !== ProduceStatus.PUBLISHED) {
    return new ConflictException('Produce is not available for ordering');
  }
  return new ConflictException(
    `Only ${produce.floatingQuantity} ${produce.unit} available`,
  );
}

export function linePrice(
  pricePerUnit: Prisma.Decimal,
  quantity: number,
): Prisma.Decimal {
  return pricePerUnit.mul(quantity).toDecimalPlaces(2);
}

/** An order's produce fields, snapshotted from the (locked) listing. */
export function orderLine(produce: Produce, quantity: number): OrderLine {
  return {
    produceId: produce.id,
    farmId: produce.farmId,
    quantity,
    produceName: produce.name,
    type: produce.type,
    totalPrice: linePrice(produce.pricePerUnit, quantity),
  };
}

// Sets Produce.status to match `produce`'s (already-updated) quantities, if
// it needs to change. Safe without an extra guard: the caller's own write
// just took this row's lock for the rest of the transaction.
function syncProduceStatus(tx: Prisma.TransactionClient, produce: Produce) {
  const status = deriveProduceStatus(produce.status, produce);
  if (status === produce.status) {
    return;
  }
  return tx.produce.update({ where: { id: produce.id }, data: { status } });
}
