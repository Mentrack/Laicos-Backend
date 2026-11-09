import { Injectable, Logger } from '@nestjs/common';
import {
  PayeeRole,
  PayoutItemKind,
  PayoutStatus,
  Prisma,
} from '../../generated/client';
import { advisoryLock } from '../common/advisory-lock';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { PAYOUT_INCLUDE, type PayoutRow } from './formatters/payout.formatter';
import { PayoutConfig } from './payout.config';
import { PayoutService } from './payout.service';
import {
  eligibleItems,
  keptShare,
  payeeIs,
  payoutAmount,
  reversalCleared,
} from './utils/eligibility';
import { PAYEE_SELECT, payeeLockKey, payeeUserId } from './utils/payee-locks';

// Paystack's bulk transfer limit.
const BULK_LIMIT = 100;

const ROLE: Record<PayoutItemKind, PayeeRole> = {
  [PayoutItemKind.PRODUCE]: PayeeRole.FARMER,
  [PayoutItemKind.COMMISSION]: PayeeRole.AGENT,
};

type Payee = { userId: string; kind: PayoutItemKind };

function orderSelect(kind: PayoutItemKind) {
  return {
    id: true,
    orderNumber: true,
    totalPrice: true,
    agentCommission: true,
    dispute: { select: { status: true, refundPercent: true } },
    handover: { select: { agentId: true } },
    payoutItems: {
      where: { kind, status: PayoutStatus.REVERSED },
      select: { payout: { select: { updatedAt: true } } },
    },
  } satisfies Prisma.OrderSelect;
}

@Injectable()
export class PayoutRunService {
  private readonly logger = new Logger(PayoutRunService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly payouts: PayoutService,
    private readonly config: PayoutConfig,
  ) {}

  // Each payee and each chunk fails alone: aborting the run would strand
  // payouts already committed as PENDING with no transfer, their live items
  // blocking those orders for good. Failures are thrown together at the end
  // so the job is marked failed; the next run recomputes skipped payees.
  async run(now = new Date()): Promise<{ payouts: number }> {
    const created: PayoutRow[] = [];
    let failedPayees = 0;
    for (const payee of await this.findPayees(now)) {
      try {
        const payout = await this.createPayout(payee, now);
        if (payout) {
          created.push(payout);
        }
      } catch (error) {
        failedPayees += 1;
        this.logger.error(
          `${payee.kind} payout for user ${payee.userId} failed; retried next run`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    let failedChunks = 0;
    for (let start = 0; start < created.length; start += BULK_LIMIT) {
      const chunk = created.slice(start, start + BULK_LIMIT);
      try {
        await this.payouts.send(chunk);
      } catch (error) {
        // Never re-sent automatically: Paystack may have accepted these, and
        // a repeat of the same reference is refused, which would mark them
        // FAILED, free the orders and pay them twice. Webhooks settle them.
        failedChunks += 1;
        this.logger.error(
          `Sending payouts ${chunk.map((payout) => payout.id).join(', ')} failed; left PENDING`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    if (failedPayees || failedChunks) {
      throw new Error(
        `Payout run incomplete: ${failedPayees} payee(s) and ${failedChunks} chunk(s) failed`,
      );
    }
    return { payouts: created.length };
  }

  // Sorted by user id, the order every multi-lock holder takes them in.
  private async findPayees(now: Date): Promise<Payee[]> {
    const payees = new Map<string, Payee>();
    for (const kind of Object.values(PayoutItemKind)) {
      const orders = await this.database.order.findMany({
        where: eligibleItems(now, this.config.holdHours, kind),
        select: PAYEE_SELECT,
      });
      for (const order of orders) {
        const userId = payeeUserId(order, kind);
        if (userId) {
          payees.set(`${userId}:${kind}`, { userId, kind });
        }
      }
    }
    return [...payees.values()].sort(
      (a, b) =>
        a.userId.localeCompare(b.userId) || a.kind.localeCompare(b.kind),
    );
  }

  // One short transaction per payee, rather than one for the whole run, so
  // a payee's lock is held only while their own payout is written. Under the
  // lock the orders are re-read, so a refund or dispute that got in first wins.
  private async createPayout(
    { userId, kind }: Payee,
    now: Date,
  ): Promise<PayoutRow | null> {
    try {
      return await this.database.$transaction(async (tx) => {
        await advisoryLock(tx, payeeLockKey(userId));
        const account = await tx.bankAccount.findUnique({ where: { userId } });
        if (!account) {
          return null;
        }
        const orders = await tx.order.findMany({
          where: {
            AND: [
              eligibleItems(now, this.config.holdHours, kind),
              payeeIs(kind, userId),
            ],
          },
          select: orderSelect(kind),
          orderBy: { fulfilledAt: 'asc' },
        });
        const items = orders
          .filter((order) =>
            reversalCleared(
              order.payoutItems.map((item) => item.payout.updatedAt),
              account.updatedAt,
            ),
          )
          .map((order) => {
            if (kind === PayoutItemKind.PRODUCE && !order.handover?.agentId) {
              this.logger.warn(
                `Order ${order.orderNumber} has no handover agent; its commission stays with Laicos`,
              );
            }
            return {
              kind,
              orderId: order.id,
              amount: payoutAmount(order, kind, keptShare(order.dispute)),
            };
          })
          .filter((item) => item.amount.gt(0));
        if (items.length === 0) {
          return null;
        }
        return tx.payout.create({
          data: {
            payeeId: userId,
            payeeRole: ROLE[kind],
            amount: items.reduce(
              (sum, item) => sum.add(item.amount),
              new Prisma.Decimal(0),
            ),
            bankName: account.bankName,
            accountNumber: account.accountNumber,
            accountName: account.accountName,
            recipientCode: account.recipientCode,
            items: { create: items },
          },
          include: PAYOUT_INCLUDE,
        });
      });
    } catch (error) {
      // The partial unique index is the backstop if anything ever writes an
      // item without the payee lock. Skip this payee; the run carries on.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      this.logger.warn(
        `Skipped ${kind} payout for user ${userId}: an order already has a live item`,
      );
      return null;
    }
  }
}
