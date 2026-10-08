import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type Payment,
} from '../../../generated/client';
import { formatPayment } from '../formatters/payment.formatter';

const base = {
  id: 'pay-1',
  reference: 'PAY-000001',
  method: PaymentMethod.BANK_TRANSFER,
  status: PaymentStatus.PENDING,
  amount: new Prisma.Decimal('57500'),
  paidAt: null,
  createdAt: new Date('2026-10-08T00:00:00Z'),
} as Payment;

const transfer = {
  bankName: 'Test Bank',
  accountName: 'LAICOS Escrow',
  accountNumber: '0123456789',
  amount: '57500.00',
  narration: 'PAY-000001',
};

describe('formatPayment', () => {
  it('reads stored transfer instructions back', () => {
    expect(
      formatPayment({
        ...base,
        providerData: { authorizationUrl: null, bankTransfer: transfer },
      }),
    ).toMatchObject({
      amount: '57500.00',
      authorizationUrl: null,
      bankTransfer: transfer,
    });
  });

  it.each([
    null,
    'junk',
    [],
    { bankTransfer: { bankName: 1 } },
    { authorizationUrl: 5 },
  ])('treats malformed provider data %p as absent', (providerData) => {
    expect(formatPayment({ ...base, providerData })).toMatchObject({
      authorizationUrl: null,
      bankTransfer: null,
    });
  });
});
