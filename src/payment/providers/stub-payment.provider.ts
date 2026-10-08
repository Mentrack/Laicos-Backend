import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentProvider,
  type Payment,
} from '../../../generated/client';
import { CheckoutConfig } from '../checkout-config';
import type {
  PaymentInitiation,
  PaymentProviderAdapter,
} from './payment-provider';

/**
 * Stands in until Paystack: charges nothing. Card payments and transfers are
 * confirmed by an admin (POST /admin/payments/{reference}/confirm).
 */
@Injectable()
export class StubPaymentProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.STUB;

  constructor(private readonly config: CheckoutConfig) {}

  initiate(payment: Payment): Promise<PaymentInitiation> {
    return Promise.resolve({
      authorizationUrl: null,
      bankTransfer:
        payment.method === PaymentMethod.BANK_TRANSFER
          ? {
              ...this.config.escrow,
              amount: payment.amount.toFixed(2),
              narration: payment.reference,
            }
          : null,
    });
  }
}
