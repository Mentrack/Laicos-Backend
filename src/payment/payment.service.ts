import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckoutStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  type User,
} from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutConfig } from './checkout-config';
import { InitiatePaymentDto } from './dto';
import { formatPayment } from './formatters/payment.formatter';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderAdapter,
} from './providers/payment-provider';
import { checkoutNotFound } from './utils/checkout-errors';
import { lockCheckout } from './utils/checkout-lock';
import { CHECKOUT_TRANSACTION } from './utils/checkout-transaction';

const HOUR_MS = 3_600_000;

/**
 * Payment attempts on a checkout. confirm() is the only way a checkout
 * becomes PAID, whoever calls it: an admin today, a provider webhook later.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: CheckoutConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderAdapter,
  ) {}

  initiate(
    user: User,
    checkoutId: string,
    idempotencyKey: string,
    dto: InitiatePaymentDto,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockCheckout(tx, checkoutId);
      const checkout = await tx.checkout.findFirst({
        where: { id: checkoutId, buyerId: user.id },
      });
      if (!checkout) {
        throw checkoutNotFound();
      }
      const replay = await tx.payment.findUnique({
        where: { checkoutId_idempotencyKey: { checkoutId, idempotencyKey } },
      });
      if (replay) {
        return formatPayment(replay);
      }
      const now = new Date();
      if (
        checkout.status !== CheckoutStatus.AWAITING_PAYMENT ||
        checkout.expiresAt <= now
      ) {
        throw new ConflictException({
          message: 'This checkout can no longer be paid',
          code: 'CHECKOUT_NOT_PAYABLE',
        });
      }
      // One attempt in flight at a time, so a late confirmation of an old
      // attempt can't pay alongside the new one.
      await tx.payment.updateMany({
        where: { checkoutId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.ABANDONED },
      });
      const created = await tx.payment.create({
        data: {
          checkoutId,
          idempotencyKey,
          method: dto.method,
          provider: this.provider.provider,
          amount: checkout.totalPrice,
        },
      });
      // Inside the transaction only because the stub makes no network call;
      // a real provider must initiate after commit.
      const initiation = await this.provider.initiate(created);
      const payment = await tx.payment.update({
        where: { id: created.id },
        data: { providerData: initiation },
      });
      if (dto.method === PaymentMethod.BANK_TRANSFER) {
        // Transfers clear slowly, so the stock is held for longer.
        const transferHold = new Date(
          now.getTime() + this.config.bankTransferHoldHours * HOUR_MS,
        );
        if (transferHold > checkout.expiresAt) {
          await tx.checkout.update({
            where: { id: checkoutId },
            data: { expiresAt: transferHold },
          });
        }
      }
      return formatPayment(payment);
    }, CHECKOUT_TRANSACTION);
  }

  async confirm(reference: string, confirmedBy: User | null) {
    const found = await this.database.payment.findUnique({
      where: { reference },
      select: { checkoutId: true },
    });
    if (!found) {
      throw new NotFoundException({
        message: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND',
      });
    }
    return this.database.$transaction(async (tx) => {
      await lockCheckout(tx, found.checkoutId);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { reference },
        include: { checkout: true },
      });
      // Webhooks retry, so a second confirmation is an answer, not an error.
      if (payment.status === PaymentStatus.SUCCEEDED) {
        return formatPayment(payment);
      }
      // Status, not expiresAt: until the sweep releases it, the stock is
      // still held, so money that lands in that gap still pays. Checked
      // before the payment's status because releasing a checkout abandons
      // its attempt, and the caller must learn the buyer needs a refund.
      if (payment.checkout.status !== CheckoutStatus.AWAITING_PAYMENT) {
        throw new ConflictException({
          message: 'This checkout expired before payment was confirmed',
          code: 'CHECKOUT_EXPIRED',
        });
      }
      if (payment.status !== PaymentStatus.PENDING) {
        throw new ConflictException({
          message: `This payment is ${payment.status} and can't be confirmed`,
          code: 'PAYMENT_NOT_PENDING',
        });
      }
      const paidAt = new Date();
      const paid = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt,
          confirmedById: confirmedBy?.id ?? null,
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
      return formatPayment(paid);
    }, CHECKOUT_TRANSACTION);
  }
}
