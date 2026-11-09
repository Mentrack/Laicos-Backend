import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  PayeeRole,
  NotificationType,
  PayoutStatus,
  Prisma,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { advisoryLock } from '../common/advisory-lock';
import { toMinorUnits } from '../common/money';
import {
  paginationMeta,
  resolvePagination,
  type PaginationQueryDto,
} from '../common/pagination';
import { PaystackClient } from '../paystack/paystack.client';
import { isDefiniteRejection, PaystackError } from '../paystack/paystack-error';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutQueryDto } from './dto';
import {
  formatPayout,
  PAYOUT_INCLUDE,
  type PayoutRow,
} from './formatters/payout.formatter';
import { totalEarnings } from './utils/earnings';

export type TransferResult = {
  // Payout.id: Paystack needs lowercase transfer references.
  reference: string;
  outcome: 'success' | 'failed' | 'reversed';
  reason: string | null;
};

const OUTCOME_STATUS = {
  success: PayoutStatus.SUCCEEDED,
  failed: PayoutStatus.FAILED,
  reversed: PayoutStatus.REVERSED,
} as const;

type Payee = {
  payeeRole: PayeeRole;
  payee: { farmer: { id: string } | null; agent: { id: string } | null };
};

// The audit actor check needs the farmer or agent row, not the User. A
// payee whose profile is gone is recorded as the system rather than failing
// the webhook forever on the check.
function payeeActor({ payeeRole, payee }: Payee) {
  if (payeeRole === PayeeRole.FARMER && payee.farmer) {
    return {
      actorType: AuditActorType.FARMER,
      farmerId: payee.farmer.id,
      agentId: null,
    };
  }
  if (payeeRole === PayeeRole.AGENT && payee.agent) {
    return {
      actorType: AuditActorType.EXTENSION_AGENT,
      farmerId: null,
      agentId: payee.agent.id,
    };
  }
  return { actorType: AuditActorType.SYSTEM, farmerId: null, agentId: null };
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly audit: AuditService,
    private readonly notification: NotificationService,
  ) {}

  // After commit, one Paystack bulk call (at most 100). Each transfer's final
  // state arrives by webhook, including any Paystack queued without
  // acknowledging here.
  async send(payouts: PayoutRow[]): Promise<PayoutRow[]> {
    const ids = payouts.map((payout) => payout.id);
    try {
      const queued = await this.paystack.bulkTransfer(
        payouts.map((payout) => ({
          amount: toMinorUnits(payout.amount),
          recipient: payout.recipientCode,
          reference: payout.id,
          reason: `LAICOS payout ${payout.reference}`,
        })),
      );
      const codes = new Map(
        queued.map((transfer) => [transfer.reference, transfer.transferCode]),
      );
      return await Promise.all(
        payouts.map((payout) =>
          this.database.payout.update({
            where: { id: payout.id },
            data: { transferCode: codes.get(payout.id) ?? null },
            include: PAYOUT_INCLUDE,
          }),
        ),
      );
    } catch (error) {
      if (!(error instanceof PaystackError)) {
        throw error;
      }
      // Paystack may have queued the transfers; failing them would free the
      // orders for a second payout. Webhooks settle them instead.
      if (!isDefiniteRejection(error)) {
        this.logger.error(
          `Bulk transfer outcome unknown, payouts left PENDING (${ids.join(', ')}): ${error.message}`,
        );
        return payouts;
      }
      this.logger.error(`Bulk transfer failed: ${error.message}`);
      await this.database.$transaction([
        this.database.payout.updateMany({
          where: { id: { in: ids }, status: PayoutStatus.PENDING },
          data: { status: PayoutStatus.FAILED, failureReason: error.message },
        }),
        this.database.payoutItem.updateMany({
          where: { payoutId: { in: ids }, status: PayoutStatus.PENDING },
          data: { status: PayoutStatus.FAILED },
        }),
      ]);
      return this.database.payout.findMany({
        where: { id: { in: ids } },
        include: PAYOUT_INCLUDE,
      });
    }
  }

  async applyTransferResult(result: TransferResult): Promise<void> {
    const status = OUTCOME_STATUS[result.outcome];
    let deliveryIds: string[] = [];
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `payout:${result.reference}`);
      const payout = await tx.payout.findUnique({
        where: { id: result.reference },
        include: {
          payee: {
            select: {
              farmer: { select: { id: true } },
              agent: { select: { id: true } },
            },
          },
        },
      });
      if (!payout) {
        this.logger.warn(
          `Transfer result for unknown payout ${result.reference}`,
        );
        return;
      }
      // Pending settles any way; a success can still be reversed by the bank.
      const allowed =
        payout.status === PayoutStatus.PENDING ||
        (payout.status === PayoutStatus.SUCCEEDED &&
          status === PayoutStatus.REVERSED);
      if (!allowed) {
        if (
          payout.status === PayoutStatus.FAILED &&
          status === PayoutStatus.SUCCEEDED
        ) {
          this.logger.error(
            `Payout ${payout.id} succeeded at Paystack but is recorded FAILED`,
          );
        }
        return;
      }
      await tx.payout.update({
        where: { id: payout.id },
        data:
          status === PayoutStatus.SUCCEEDED
            ? { status, paidAt: new Date(), failureReason: null }
            : { status, failureReason: result.reason },
      });
      await tx.payoutItem.updateMany({
        where: { payoutId: payout.id },
        data: { status },
      });
      if (status === PayoutStatus.SUCCEEDED) {
        await this.audit.record(tx, {
          ...payeeActor(payout),
          farmId: null,
          category: AuditCategory.PAYOUT,
          title: `Payout ${payout.reference} paid`,
          summary: `₦${payout.amount.toFixed(2)} to ${payout.bankName}`,
          actionLabel: 'View payout',
          resource: AuditResource.PAYOUT,
          resourceId: payout.id,
        });
        deliveryIds = await this.notification.notify(
          {
            userIds: [payout.payeeId],
            type: NotificationType.PAYOUT_PAID,
            params: {
              payoutId: payout.id,
              reference: payout.reference,
              amount: payout.amount.toFixed(2),
            },
          },
          tx,
        );
      } else if (status === PayoutStatus.REVERSED) {
        await this.audit.record(tx, {
          ...payeeActor(payout),
          farmId: null,
          category: AuditCategory.PAYOUT,
          title: `Payout ${payout.reference} reversed`,
          summary:
            result.reason ??
            `₦${payout.amount.toFixed(2)} to ${payout.bankName}`,
          actionLabel: 'View payout',
          resource: AuditResource.PAYOUT,
          resourceId: payout.id,
        });
      }
    });
    void this.notification.dispatch(deliveryIds);
  }

  async findAll(query: PayoutQueryDto) {
    return this.list(
      { status: query.status, payeeRole: query.payeeRole },
      query,
    );
  }

  async findMine(user: User, query: PaginationQueryDto) {
    return this.list(
      { payeeId: user.id, status: PayoutStatus.SUCCEEDED },
      query,
    );
  }

  async summary(user: User) {
    return { totalEarnings: await totalEarnings(this.database, user.id) };
  }

  private async list(
    where: Prisma.PayoutWhereInput,
    query: PaginationQueryDto,
  ) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const [payouts, total] = await this.database.$transaction([
      this.database.payout.findMany({
        where,
        include: PAYOUT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.payout.count({ where }),
    ]);
    return {
      data: payouts.map(formatPayout),
      metaData: paginationMeta(page, perPage, total),
    };
  }
}
