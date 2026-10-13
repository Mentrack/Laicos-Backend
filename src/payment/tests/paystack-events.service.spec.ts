import type { PaystackClient } from '../../paystack/paystack.client';
import type { PayoutService } from '../../payout/payout.service';
import type { PaymentService } from '../payment.service';
import { PaystackEventsService } from '../paystack-events.service';
import type { RefundService } from '../refund.service';

describe('PaystackEventsService', () => {
  const paystack = { verifyTransaction: jest.fn() };
  const payments = { applyVerifiedCharge: jest.fn() };
  const refunds = { applyResult: jest.fn() };
  const payouts = { applyTransferResult: jest.fn() };
  const service = new PaystackEventsService(
    paystack as unknown as PaystackClient,
    payments as unknown as PaymentService,
    refunds as unknown as RefundService,
    payouts as unknown as PayoutService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('re-verifies a charge before applying it', async () => {
    const verified = { reference: 'PAY-000001', status: 'success' };
    paystack.verifyTransaction.mockResolvedValue(verified);
    await service.handle({
      event: 'charge.success',
      data: { reference: 'PAY-000001', amount: 1 },
    });
    expect(paystack.verifyTransaction).toHaveBeenCalledWith('PAY-000001');
    expect(payments.applyVerifiedCharge).toHaveBeenCalledWith(verified, null);
  });

  it.each([
    ['refund.processed', true],
    ['refund.failed', false],
  ])('passes %s on', async (event, processed) => {
    await service.handle({
      event,
      data: { id: 3018284, transaction_reference: 'PAY-000001', reason: 'x' },
    });
    expect(refunds.applyResult).toHaveBeenCalledWith({
      providerRefundId: '3018284',
      transactionReference: 'PAY-000001',
      processed,
      reason: 'x',
    });
  });

  it('reads the transaction reference from a nested transaction too', async () => {
    await service.handle({
      event: 'refund.processed',
      data: { transaction: { reference: 'PAY-000002' } },
    });
    expect(refunds.applyResult).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRefundId: null,
        transactionReference: 'PAY-000002',
      }),
    );
  });

  it.each([
    ['transfer.success', 'success'],
    ['transfer.failed', 'failed'],
    ['transfer.reversed', 'reversed'],
  ])('passes %s on', async (event, outcome) => {
    await service.handle({
      event,
      data: { reference: 'payout-a', gateway_response: 'Account closed' },
    });
    expect(payouts.applyTransferResult).toHaveBeenCalledWith({
      reference: 'payout-a',
      outcome,
      reason: 'Account closed',
    });
  });

  it('ignores other events', async () => {
    await service.handle({ event: 'subscription.create', data: {} });
    expect(payments.applyVerifiedCharge).not.toHaveBeenCalled();
    expect(refunds.applyResult).not.toHaveBeenCalled();
    expect(payouts.applyTransferResult).not.toHaveBeenCalled();
  });

  it('throws on a charge event without a reference, so the job is retried', async () => {
    await expect(
      service.handle({ event: 'charge.success', data: {} }),
    ).rejects.toThrow();
  });
});
