import { Prisma } from '../../generated/client';

const { ROUND_UP, ROUND_DOWN, ROUND_HALF_UP } = Prisma.Decimal;

/** Paystack amounts are integers in kobo or cents. */
export function toMinorUnits(amount: Prisma.Decimal): number {
  return amount.mul(100).toDecimalPlaces(0, ROUND_HALF_UP).toNumber();
}

export function percentOf(
  amount: Prisma.Decimal,
  percent: Prisma.Decimal,
): Prisma.Decimal {
  return amount.mul(percent).div(100).toDecimalPlaces(2, ROUND_HALF_UP);
}

// Up, so converting never leaves Laicos short of the naira total.
export function ngnToUsd(
  ngn: Prisma.Decimal,
  ngnPerUsd: Prisma.Decimal,
): Prisma.Decimal {
  return ngn.div(ngnPerUsd).toDecimalPlaces(2, ROUND_UP);
}

// Down, so refunds of parts of a payment can never add up to more than it.
export function proportionalShare(
  part: Prisma.Decimal,
  whole: Prisma.Decimal,
  charged: Prisma.Decimal,
): Prisma.Decimal {
  return part.mul(charged).div(whole).toDecimalPlaces(2, ROUND_DOWN);
}
