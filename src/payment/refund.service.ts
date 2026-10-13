import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  RefundStatus,
  type Checkout,
  type Payment,
  type Refund,
  type User,
} from '../../generated/client';
import { advisoryLock } from '../common/advisory-lock';
import { proportionalShare, toMinorUnits } from '../common/money';
import { PaystackClient } from '../paystack/paystack.client';
import { isDefiniteRejection, PaystackError } from '../paystack/paystack-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRefundDto, RefundDto } from './dto';
import { formatRefund } from './formatters/refund.formatter';
import { paymentNotFound } from './utils/checkout-errors';

export type RefundResult = {
  providerRefundId: string | null;
  transactionReference: string;
  processed: boolean;
  reason: string | null;
};

type PaymentWithCheckout = Payment & { checkout: Checkout };

function conflict(message: string, code: string) {
  return new ConflictException({ message, code });
}

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly paystack: PaystackClient,
  ) {}

  /** One cancelled order, or whatever is left of the payment. */
  async refund(
    admin: User,
    reference: string,
    dto: CreateRefundDto,
  ): Promise<RefundDto> {
    const found = await this.database.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!found) {
      throw paymentNotFound();
    }
    const refund = await this.database.$transaction(async (tx) => {
      // Two admins refunding at once must not both see the same balance.
      await advisoryLock(tx, `payment:${found.id}`);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: found.id },
        include: { checkout: true, refunds: true },
      });
      // An orphan's balance can be refunded again if its automatic refund
      // failed, but its orders were never paid by it, so not order by order.
      const refundable =
        payment.status === PaymentStatus.SUCCEEDED ||
        (!dto.orderId && payment.status === PaymentStatus.ORPHANED);
      if (!refundable) {
        throw conflict(
          'Only a successful payment, or the balance of an orphaned one, can be refunded',
          'PAYMENT_NOT_REFUNDABLE',
        );
      }
      if (
        !dto.orderId &&
        payment.status === PaymentStatus.SUCCEEDED &&
        (await lockAndCheckPayouts(tx, payment.checkoutId))
      ) {
        throw conflict(
          "Reverse this checkout's payouts before refunding it in full",
          'ORDERS_PAID_OUT',
        );
      }
      const live = payment.refunds.filter(
        (existing) => existing.status !== RefundStatus.FAILED,
      );
      const remaining = live.reduce(
        (left, existing) => left.sub(existing.amount),
        payment.chargedAmount,
      );
      const amount = dto.orderId
        ? await orderRefundAmount(tx, payment, live, dto.orderId)
        : remaining;
      if (remaining.lte(0)) {
        throw conflict(
          'Nothing is left to refund on this payment',
          'NOTHING_TO_REFUND',
        );
      }
      if (amount.gt(remaining)) {
        throw conflict(
          `Only ${remaining.toFixed(2)} is left to refund on this payment`,
          'REFUND_EXCEEDS_BALANCE',
        );
      }
      return tx.refund.create({
        data: {
          paymentId: payment.id,
          orderId: dto.orderId ?? null,
          amount,
          reason: dto.reason,
          initiatedById: admin.id,
        },
      });
    });
    // Logged before Paystack is called: if we crash now, this is how the
    // PENDING row without a providerRefundId gets found and settled by hand.
    this.logger.warn(`Submitting refund ${refund.id} on ${reference}`);
    return formatRefund(await this.submit(refund, reference));
  }

  /** Money that couldn't be applied goes straight back, in full. */
  createAutomatic(
    tx: Prisma.TransactionClient,
    payment: Payment,
    reason: string,
  ): Promise<Refund> {
    return tx.refund.create({
      data: { paymentId: payment.id, amount: payment.chargedAmount, reason },
    });
  }

  // After commit, like every Paystack call. A refusal is recorded, not
  // thrown: the admin sees it and can ask again. An unknown outcome stays
  // PENDING, still holding its share of the balance, until the webhook
  // settles it; failing it could refund the buyer twice.
  async submit(refund: Refund, reference: string): Promise<Refund> {
    try {
      const { id } = await this.paystack.createRefund({
        reference,
        amount: toMinorUnits(refund.amount),
      });
      return await this.database.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: id },
      });
    } catch (error) {
      if (!(error instanceof PaystackError)) {
        throw error;
      }
      if (!isDefiniteRejection(error)) {
        this.logger.error(
          `Refund ${refund.id} on ${reference} outcome unknown, left PENDING: ${error.message}`,
        );
        return refund;
      }
      this.logger.error(
        `Refund ${refund.id} on ${reference} refused: ${error.message}`,
      );
      // The webhook may already have settled it.
      await this.database.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PENDING },
        data: { status: RefundStatus.FAILED, failureReason: error.message },
      });
      return this.database.refund.findUniqueOrThrow({
        where: { id: refund.id },
      });
    }
  }

  async applyResult(result: RefundResult): Promise<void> {
    const refund = await this.findForResult(result);
    if (!refund) {
      this.logger.warn(
        `Paystack refund result for unknown refund on ${result.transactionReference}`,
      );
      return;
    }
    if (refund.status !== RefundStatus.PENDING) {
      if (result.processed && refund.status === RefundStatus.FAILED) {
        this.logger.error(
          `Refund ${refund.id} on ${result.transactionReference} was processed by Paystack but is recorded FAILED`,
        );
      }
      return;
    }
    await this.database.refund.updateMany({
      where: { id: refund.id, status: RefundStatus.PENDING },
      data: result.processed
        ? { status: RefundStatus.PROCESSED }
        : {
            status: RefundStatus.FAILED,
            failureReason:
              result.reason ?? 'Paystack could not process the refund',
          },
    });
  }

  private async findForResult({
    providerRefundId,
    transactionReference,
  }: RefundResult) {
    if (providerRefundId) {
      const byId = await this.database.refund.findFirst({
        where: { providerRefundId },
      });
      if (byId) {
        return byId;
      }
    }
    // The webhook can arrive before submit() has stored providerRefundId.
    return this.database.refund.findFirst({
      where: {
        status: RefundStatus.PENDING,
        payment: { reference: transactionReference },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}

// Takes the same per-farmer locks payout approval does (sorted, like approval)
// before looking, so a full refund and a payout of the same orders can't both
// commit. Approval never takes payment locks, so there's no deadlock cycle.
async function lockAndCheckPayouts(
  tx: Prisma.TransactionClient,
  checkoutId: string,
): Promise<boolean> {
  const orders = await tx.order.findMany({
    where: { checkoutId },
    select: { farm: { select: { ownerId: true } } },
  });
  const farmerIds = [...new Set(orders.map(({ farm }) => farm.ownerId))].sort();
  for (const farmerId of farmerIds) {
    await advisoryLock(tx, `payout:farmer:${farmerId}`);
  }
  const item = await tx.payoutItem.findFirst({
    where: {
      order: { checkoutId },
      status: { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] },
    },
    select: { id: true },
  });
  return item !== null;
}

async function orderRefundAmount(
  tx: Prisma.TransactionClient,
  payment: PaymentWithCheckout,
  live: Refund[],
  orderId: string,
): Promise<Prisma.Decimal> {
  const order = await tx.order.findFirst({
    where: { id: orderId, checkoutId: payment.checkoutId },
  });
  if (!order || order.status !== OrderStatus.CANCELLED) {
    throw conflict(
      'Only a cancelled order on this payment can be refunded',
      'ORDER_NOT_REFUNDABLE',
    );
  }
  if (live.some((existing) => existing.orderId === orderId)) {
    throw conflict(
      'This order has already been refunded',
      'ORDER_ALREADY_REFUNDED',
    );
  }
  const { serviceFee, subtotal } = payment.checkout;
  // Its share of the service fee goes back with the order; delivery doesn't,
  // because the rest of the checkout is still delivered.
  const ngn = order.totalPrice.add(
    order.totalPrice.mul(serviceFee).div(subtotal),
  );
  return proportionalShare(ngn, payment.amount, payment.chargedAmount);
}
