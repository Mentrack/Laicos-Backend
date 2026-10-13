import { Injectable } from '@nestjs/common';
import { isRecord } from '../common/narrow';
import { optionalIdentifier, optionalText, text } from '../paystack/narrow';
import { PaystackClient } from '../paystack/paystack.client';
import { PaystackError } from '../paystack/paystack-error';
import { PayoutService, type TransferResult } from '../payout/payout.service';
import { PaymentService } from './payment.service';
import type { PaystackEvent } from './paystack-events';
import { RefundService, type RefundResult } from './refund.service';

/** Applies one queued Paystack event. Every path is safe to repeat. */
@Injectable()
export class PaystackEventsService {
  constructor(
    private readonly paystack: PaystackClient,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly payouts: PayoutService,
  ) {}

  async handle({ event, data }: PaystackEvent): Promise<void> {
    switch (event) {
      case 'charge.success': {
        // The webhook body is only a hint; Paystack's verify API is the truth.
        const verified = await this.paystack.verifyTransaction(
          text(data, 'reference'),
        );
        await this.payments.applyVerifiedCharge(verified, null);
        return;
      }
      case 'refund.processed':
        return this.refunds.applyResult(refundResult(data, true));
      case 'refund.failed':
        return this.refunds.applyResult(refundResult(data, false));
      case 'transfer.success':
        return this.payouts.applyTransferResult(
          transferResult(data, 'success'),
        );
      case 'transfer.failed':
        return this.payouts.applyTransferResult(transferResult(data, 'failed'));
      case 'transfer.reversed':
        return this.payouts.applyTransferResult(
          transferResult(data, 'reversed'),
        );
      default:
        return;
    }
  }
}

function refundResult(
  data: Record<string, unknown>,
  processed: boolean,
): RefundResult {
  const transactionReference =
    optionalText(data, 'transaction_reference') ??
    (isRecord(data.transaction)
      ? optionalText(data.transaction, 'reference')
      : null);
  if (!transactionReference) {
    throw new PaystackError(
      'Malformed Paystack refund event: transaction reference',
      null,
    );
  }
  return {
    providerRefundId: optionalIdentifier(data, 'id'),
    transactionReference,
    processed,
    reason: optionalText(data, 'reason'),
  };
}

function transferResult(
  data: Record<string, unknown>,
  outcome: TransferResult['outcome'],
): TransferResult {
  return {
    reference: text(data, 'reference'),
    outcome,
    reason:
      optionalText(data, 'gateway_response') ?? optionalText(data, 'reason'),
  };
}
