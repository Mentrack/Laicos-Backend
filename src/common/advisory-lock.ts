import type { Prisma } from '../../generated/client';

// Serialises work on one key for the rest of the transaction, for invariants
// no constraint can express.
export async function advisoryLock(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
