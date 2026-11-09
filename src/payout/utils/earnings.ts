import { PayoutStatus, Prisma } from '../../../generated/client';

/** Money that has actually reached the payee, as a 2 dp NGN string. */
export async function totalEarnings(
  client: Prisma.TransactionClient,
  payeeId: string,
): Promise<string> {
  const paid = await client.payout.aggregate({
    where: { payeeId, status: PayoutStatus.SUCCEEDED },
    _sum: { amount: true },
  });
  return (paid._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
}
