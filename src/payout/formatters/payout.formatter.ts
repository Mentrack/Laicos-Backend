import type { Prisma } from '../../../generated/client';
import type { PayoutDto } from '../dto';
import { maskAccount } from '../utils/mask-account';

export const PAYOUT_INCLUDE = { items: true } satisfies Prisma.PayoutInclude;

export type PayoutRow = Prisma.PayoutGetPayload<{
  include: typeof PAYOUT_INCLUDE;
}>;

export function formatPayout(payout: PayoutRow): PayoutDto {
  return {
    id: payout.id,
    reference: payout.reference,
    payeeId: payout.payeeId,
    payeeRole: payout.payeeRole,
    amount: payout.amount.toFixed(2),
    status: payout.status,
    bankName: payout.bankName,
    accountNumber: maskAccount(payout.accountNumber),
    accountName: payout.accountName,
    failureReason: payout.failureReason,
    paidAt: payout.paidAt,
    createdAt: payout.createdAt,
    items: payout.items.map((item) => ({
      orderId: item.orderId,
      amount: item.amount.toFixed(2),
    })),
  };
}
