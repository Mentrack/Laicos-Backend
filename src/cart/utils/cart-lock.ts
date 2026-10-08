import type { Prisma } from '../../../generated/client';

// Every cart write, cart checkout and Buy Now serialise per buyer. Without it, checkout
// could empty an item added after it read the cart, and two adds of one
// produce could both try to insert it (or both slip past the item cap).
export async function lockCart(
  tx: Prisma.TransactionClient,
  buyerId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cart:${buyerId}`}, 0))`;
}
