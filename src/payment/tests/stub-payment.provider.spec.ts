import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
  type Payment,
} from '../../../generated/client';
import { StubPaymentProvider } from '../providers/stub-payment.provider';
import { testCheckoutConfig } from './checkout-config.fixture';

const payment = {
  reference: 'PAY-000001',
  amount: new Prisma.Decimal('57500'),
} as Payment;

describe('StubPaymentProvider', () => {
  const stub = new StubPaymentProvider(testCheckoutConfig());

  it('is the STUB provider', () => {
    expect(stub.provider).toBe(PaymentProvider.STUB);
  });

  it('needs nothing more for a card payment yet', async () => {
    await expect(
      stub.initiate({ ...payment, method: PaymentMethod.CARD }),
    ).resolves.toEqual({ authorizationUrl: null, bankTransfer: null });
  });

  it('gives escrow details for a bank transfer, narrated by reference', async () => {
    await expect(
      stub.initiate({ ...payment, method: PaymentMethod.BANK_TRANSFER }),
    ).resolves.toEqual({
      authorizationUrl: null,
      bankTransfer: {
        bankName: 'Test Bank',
        accountName: 'LAICOS Escrow',
        accountNumber: '0123456789',
        amount: '57500.00',
        narration: 'PAY-000001',
      },
    });
  });
});
