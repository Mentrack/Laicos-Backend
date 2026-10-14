import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  CheckoutStatus,
  Currency,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  type Checkout,
  type Payment,
  type User,
} from '../../generated/client';
import { requireBuyer } from '../buyer/utils/require-buyer';
import { ngnToUsd, toMinorUnits } from '../common/money';
import { FxService } from '../fx/fx.service';
import {
  PaystackClient,
  type VerifiedTransaction,
} from '../paystack/paystack.client';
import { PaystackConfig } from '../paystack/paystack.config';
import {
  orProviderUnavailable,
  PaystackError,
  providerUnavailable,
} from '../paystack/paystack-error';
import { PrismaService } from '../prisma/prisma.service';
import { InitiatePaymentDto, PaymentDto } from './dto';
import { formatPayment } from './formatters/payment.formatter';
import { checkoutNotFound, paymentNotFound } from './utils/checkout-errors';
import { lockCheckout } from './utils/checkout-lock';
import { RefundService } from './refund.service';
import { CHECKOUT_TRANSACTION } from './utils/checkout-transaction';

// Money can land on an attempt the buyer has since replaced, or one marked
// FAILED because initialize errored though Paystack had accepted it; it still
// pays if the checkout is waiting for it.
const APPLICABLE: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.ABANDONED,
  PaymentStatus.FAILED,
];

type PaymentWithCheckout = Payment & { checkout: Checkout };

/**
 * Payment attempts on a checkout. Only a charge Paystack has verified turns
 * a checkout PAID.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly database: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly paystackConfig: PaystackConfig,
    private readonly fx: FxService,
    private readonly refunds: RefundService,
  ) {}

  private readonly logger = new Logger(PaymentService.name);

  async initiate(
    user: User,
    checkoutId: string,
    idempotencyKey: string,
    dto: InitiatePaymentDto,
  ) {
    const { payment, created } = await this.database.$transaction(
      async (tx) => {
        await lockCheckout(tx, checkoutId);
        const buyer = await requireBuyer(this.database, user);
        const checkout = await tx.checkout.findFirst({
          where: { id: checkoutId, buyerId: buyer.id },
        });
        if (!checkout) {
          throw checkoutNotFound();
        }
        const replay = await tx.payment.findUnique({
          where: { checkoutId_idempotencyKey: { checkoutId, idempotencyKey } },
        });
        if (replay) {
          return { payment: replay, created: false };
        }
        if (
          checkout.status !== CheckoutStatus.AWAITING_PAYMENT ||
          checkout.expiresAt <= new Date()
        ) {
          throw new ConflictException({
            message: 'This checkout can no longer be paid',
            code: 'CHECKOUT_NOT_PAYABLE',
          });
        }
        const charge = await this.chargeFor(checkout.totalPrice, dto.currency);
        // The newest attempt is the one the buyer is shown.
        await tx.payment.updateMany({
          where: { checkoutId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.ABANDONED },
        });
        const payment = await tx.payment.create({
          data: {
            checkoutId,
            idempotencyKey,
            provider: PaymentProvider.PAYSTACK,
            amount: checkout.totalPrice,
            currency: dto.currency,
            ...charge,
          },
        });
        return { payment, created: true };
      },
      CHECKOUT_TRANSACTION,
    );
    // A replay returns what the first call stored; Paystack is called once.
    if (!created) {
      return formatPayment(payment);
    }
    return formatPayment(await this.openCheckout(payment, user.email));
  }

  private async chargeFor(amount: Prisma.Decimal, currency: Currency) {
    if (currency === Currency.NGN) {
      return { chargedAmount: amount, fxRate: null };
    }
    const { rate } = await this.fx.effectiveRate();
    return { chargedAmount: ngnToUsd(amount, rate), fxRate: rate };
  }

  // After commit: a slow Paystack must not hold the checkout lock.
  private async openCheckout(payment: Payment, email: string) {
    try {
      const { authorizationUrl, accessCode } =
        await this.paystack.initializeTransaction({
          email,
          amount: toMinorUnits(payment.chargedAmount),
          currency: payment.currency,
          reference: payment.reference,
          callbackUrl: this.paystackConfig.callbackUrl,
          channels: payment.currency === Currency.USD ? ['card'] : undefined,
          metadata: { checkoutId: payment.checkoutId, paymentId: payment.id },
        });
      return await this.database.payment.update({
        where: { id: payment.id },
        data: { providerData: { authorizationUrl, accessCode } },
      });
    } catch (error) {
      if (!(error instanceof PaystackError)) {
        throw error;
      }
      await this.database.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, failureReason: error.message },
      });
      throw providerUnavailable();
    }
  }

  async verify(admin: User, reference: string): Promise<PaymentDto> {
    const found = await this.database.payment.findUnique({
      where: { reference },
      select: { checkoutId: true },
    });
    if (!found) {
      throw paymentNotFound();
    }
    const verified = await orProviderUnavailable(() =>
      this.paystack.verifyTransaction(reference),
    );
    const payment = await this.applyVerifiedCharge(verified, admin);
    if (!payment) {
      throw paymentNotFound();
    }
    return payment;
  }

  /**
   * The only way a checkout becomes PAID: a charge Paystack has verified,
   * from the webhook or an admin's verify.
   */
  async applyVerifiedCharge(
    verified: VerifiedTransaction,
    appliedBy: User | null,
  ): Promise<PaymentDto | null> {
    const found = await this.database.payment.findUnique({
      where: { reference: verified.reference },
      select: { checkoutId: true },
    });
    if (!found) {
      this.logger.warn(`Paystack charge for unknown ${verified.reference}`);
      return null;
    }
    const { payment, refund, mismatch } = await this.database.$transaction(
      async (tx) => {
        await lockCheckout(tx, found.checkoutId);
        const payment = await tx.payment.findUniqueOrThrow({
          where: { reference: verified.reference },
          include: { checkout: true },
        });
        // Webhooks retry and admins re-verify: a settled payment is an answer.
        if (!APPLICABLE.includes(payment.status)) {
          return { payment, refund: null, mismatch: false };
        }
        if (verified.status !== 'success') {
          // Anything but 'failed' (e.g. 'abandoned') means not paid yet.
          if (
            verified.status !== 'failed' ||
            payment.status !== PaymentStatus.PENDING
          ) {
            return { payment, refund: null, mismatch: false };
          }
          const failed = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              failureReason: 'Paystack reported the charge failed',
            },
          });
          return { payment: failed, refund: null, mismatch: false };
        }
        const paidAt = new Date();
        const orphan = orphanReason(payment, verified);
        if (orphan) {
          const orphaned = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.ORPHANED,
              failureReason: orphan.reason,
              channel: verified.channel,
              paidAt,
            },
          });
          const refund = await this.refunds.createAutomatic(
            tx,
            orphaned,
            orphan.reason,
          );
          return { payment: orphaned, refund, mismatch: orphan.mismatch };
        }
        const paid = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            paidAt,
            channel: verified.channel,
            confirmedById: appliedBy?.id ?? null,
          },
        });
        await tx.checkout.update({
          where: { id: payment.checkoutId },
          data: { status: CheckoutStatus.PAID, paidAt },
        });
        await tx.order.updateMany({
          where: {
            checkoutId: payment.checkoutId,
            status: OrderStatus.AWAITING_PAYMENT,
          },
          data: { status: OrderStatus.PENDING },
        });
        return { payment: paid, refund: null, mismatch: false };
      },
      CHECKOUT_TRANSACTION,
    );
    if (refund) {
      // Logged before Paystack is called, so a crash here still leaves the
      // refund id to settle by hand.
      const note = `Refunding orphaned payment ${payment.reference} with refund ${refund.id}: ${refund.reason}`;
      if (mismatch) {
        this.logger.error(note);
      } else {
        this.logger.warn(note);
      }
      await this.refunds.submit(refund, payment.reference);
    }
    return formatPayment(payment);
  }
}

function orphanReason(
  payment: PaymentWithCheckout,
  verified: VerifiedTransaction,
): { reason: string; mismatch: boolean } | null {
  const expected = toMinorUnits(payment.chargedAmount);
  if (verified.currency !== payment.currency || verified.amount !== expected) {
    return {
      reason: `Paystack charged ${verified.amount} ${verified.currency} (minor units); expected ${expected} ${payment.currency}`,
      mismatch: true,
    };
  }
  if (payment.checkout.status !== CheckoutStatus.AWAITING_PAYMENT) {
    return {
      reason: `Checkout was ${payment.checkout.status} when the money arrived`,
      mismatch: false,
    };
  }
  return null;
}
