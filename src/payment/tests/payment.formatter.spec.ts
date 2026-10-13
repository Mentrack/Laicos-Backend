import {
  Currency,
  PaymentStatus,
  Prisma,
  type Payment,
} from '../../../generated/client';
import { formatPayment } from '../formatters/payment.formatter';

const base = {
  id: 'pay-1',
  reference: 'PAY-000001',
  status: PaymentStatus.PENDING,
  currency: Currency.USD,
  amount: new Prisma.Decimal('57500'),
  chargedAmount: new Prisma.Decimal('37.58'),
  fxRate: new Prisma.Decimal('1530.123456'),
  channel: null,
  failureReason: null,
  providerData: null,
  paidAt: null,
  createdAt: new Date('2026-10-12T00:00:00Z'),
} as Payment;

describe('formatPayment', () => {
  it('formats amounts and the rate as fixed strings', () => {
    expect(formatPayment(base)).toMatchObject({
      currency: Currency.USD,
      amount: '57500.00',
      chargedAmount: '37.58',
      fxRate: '1530.123456',
      authorizationUrl: null,
      accessCode: null,
    });
  });

  it('reads the stored Paystack checkout back', () => {
    expect(
      formatPayment({
        ...base,
        providerData: {
          authorizationUrl: 'https://checkout.paystack.com/abc',
          accessCode: 'abc',
        },
      }),
    ).toMatchObject({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
    });
  });

  it('treats malformed provider data as absent', () => {
    expect(
      formatPayment({ ...base, providerData: { authorizationUrl: 42 } }),
    ).toMatchObject({ authorizationUrl: null, accessCode: null });
  });

  it('has no rate for a naira payment', () => {
    expect(
      formatPayment({ ...base, currency: Currency.NGN, fxRate: null }).fxRate,
    ).toBeNull();
  });
});
