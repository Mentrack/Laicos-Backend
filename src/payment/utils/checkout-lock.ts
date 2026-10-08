import type { Prisma } from '../../../generated/client';

// Paying, confirming, cancelling and expiring a checkout serialise on it, so
// a payment can't land on a checkout the sweep is releasing.
export async function lockCheckout(
  tx: Prisma.TransactionClient,
  checkoutId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${checkoutId}`}, 0))`;
}
