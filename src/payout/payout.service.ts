import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
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
import { requireFarmer } from '../farm/utils/require-farmer';
import { PaystackClient } from '../paystack/paystack.client';
import { isDefiniteRejection, PaystackError } from '../paystack/paystack-error';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovePayoutsDto, PayoutBatchDto, PayoutQueryDto } from './dto';
import {
  formatEligible,
  formatPayout,
  PAYOUT_INCLUDE,
  type PayoutRow,
} from './formatters/payout.formatter';
import { PayoutConfig } from './payout.config';
import { eligibleOrders } from './utils/eligibility';

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

// Up to 100 farmers, each locked and summed in turn.
const PAYOUT_TRANSACTION = { timeout: 30_000, maxWait: 5_000 };

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly config: PayoutConfig,
    private readonly audit: AuditService,
  ) {}

  async findEligible(query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const orders = eligibleOrders(new Date(), this.config.holdHours);
    const where: Prisma.FarmerWhereInput = {
      farms: { some: { orders: { some: orders } } },
    };
    const [farmers, total] = await this.database.$transaction([
      this.database.farmer.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true } },
          bankAccount: true,
          farms: {
            select: {
              orders: {
                where: orders,
                select: {
                  id: true,
                  orderNumber: true,
                  totalPrice: true,
                  fulfilledAt: true,
                },
                orderBy: { fulfilledAt: 'asc' },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.database.farmer.count({ where }),
    ]);
    return {
      data: farmers.flatMap((farmer) =>
        farmer.bankAccount ? [formatEligible(farmer, farmer.bankAccount)] : [],
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async approve(admin: User, dto: ApprovePayoutsDto): Promise<PayoutBatchDto> {
    const now = new Date();
    // Sorted so concurrent approvals take the farmer locks in one order.
    const farmerIds = [...dto.farmerIds].sort();
    const { created, skippedFarmerIds } = await this.database.$transaction(
      async (tx) => {
        const created: PayoutRow[] = [];
        const skippedFarmerIds: string[] = [];
        for (const farmerId of farmerIds) {
          await advisoryLock(tx, `payout:farmer:${farmerId}`);
          const farmer = await tx.farmer.findUnique({
            where: { id: farmerId },
            include: { bankAccount: true },
          });
          const account = farmer?.bankAccount;
          const orders = account
            ? await tx.order.findMany({
                where: {
                  AND: [
                    eligibleOrders(now, this.config.holdHours),
                    { farm: { ownerId: farmerId } },
                  ],
                },
                select: { id: true, totalPrice: true },
              })
            : [];
          if (!account || orders.length === 0) {
            skippedFarmerIds.push(farmerId);
            continue;
          }
          created.push(
            await tx.payout.create({
              data: {
                farmerId,
                amount: orders.reduce(
                  (sum, order) => sum.add(order.totalPrice),
                  new Prisma.Decimal(0),
                ),
                bankName: account.bankName,
                accountNumber: account.accountNumber,
                accountName: account.accountName,
                recipientCode: account.recipientCode,
                approvedById: admin.id,
                items: {
                  create: orders.map((order) => ({
                    orderId: order.id,
                    amount: order.totalPrice,
                  })),
                },
              },
              include: PAYOUT_INCLUDE,
            }),
          );
        }
        return { created, skippedFarmerIds };
      },
      PAYOUT_TRANSACTION,
    );
    const sent = created.length > 0 ? await this.send(created) : [];
    return { payouts: sent.map(formatPayout), skippedFarmerIds };
  }

  // After commit. Each transfer's final state arrives by webhook, including
  // any Paystack queued without acknowledging here.
  private async send(payouts: PayoutRow[]): Promise<PayoutRow[]> {
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
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `payout:${result.reference}`);
      const payout = await tx.payout.findUnique({
        where: { id: result.reference },
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
          actorType: AuditActorType.FARMER,
          farmerId: payout.farmerId,
          agentId: null,
          farmId: null,
          category: AuditCategory.PAYOUT,
          title: `Payout ${payout.reference} paid`,
          summary: `₦${payout.amount.toFixed(2)} to ${payout.bankName}`,
          actionLabel: 'View payout',
          resource: AuditResource.PAYOUT,
          resourceId: payout.id,
        });
      } else if (status === PayoutStatus.REVERSED) {
        await this.audit.record(tx, {
          actorType: AuditActorType.FARMER,
          farmerId: payout.farmerId,
          agentId: null,
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
  }

  async findAll(query: PayoutQueryDto) {
    return this.list({ status: query.status }, query);
  }

  async findMine(user: User, query: PaginationQueryDto) {
    const farmer = await requireFarmer(this.database, user);
    return this.list({ farmerId: farmer.id }, query);
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
