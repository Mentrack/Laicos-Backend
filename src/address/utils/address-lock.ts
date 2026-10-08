import type { Prisma } from '../../../generated/client';

// Serialises a buyer's address writes, so two default switches can't both
// clear and set, and two creates can't both slip past the cap.
export async function lockAddresses(
  tx: Prisma.TransactionClient,
  buyerId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`addresses:${buyerId}`}, 0))`;
}
