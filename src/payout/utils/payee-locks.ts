import { PayoutItemKind, type Prisma } from '../../../generated/client';
import { advisoryLock } from '../../common/advisory-lock';

export const PAYEE_SELECT = {
  farm: { select: { owner: { select: { userId: true } } } },
  handover: { select: { agent: { select: { userId: true } } } },
} satisfies Prisma.OrderSelect;

type PayeeRow = Prisma.OrderGetPayload<{ select: typeof PAYEE_SELECT }>;

/** User.id paid for this kind of item on the order, if anyone is. */
export function payeeUserId(
  order: PayeeRow,
  kind: PayoutItemKind,
): string | null {
  return kind === PayoutItemKind.PRODUCE
    ? order.farm.owner.userId
    : (order.handover?.agent?.userId ?? null);
}

// Every path that creates payout items or refunds a whole checkout takes
// these before looking, sorted so two multi-lock holders can't deadlock.
export async function lockPayees(
  tx: Prisma.TransactionClient,
  orderWhere: Prisma.OrderWhereInput,
): Promise<void> {
  const orders = await tx.order.findMany({
    where: orderWhere,
    select: PAYEE_SELECT,
  });
  const userIds = new Set(
    orders.flatMap((order) =>
      Object.values(PayoutItemKind).flatMap(
        (kind) => payeeUserId(order, kind) ?? [],
      ),
    ),
  );
  for (const userId of [...userIds].sort()) {
    await advisoryLock(tx, payeeLockKey(userId));
  }
}

export function payeeLockKey(userId: string): string {
  return `payout:user:${userId}`;
}
