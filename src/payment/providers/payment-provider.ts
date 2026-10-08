import type { Payment, PaymentProvider } from '../../../generated/client';

// `type`, not `interface`: these are stored as Payment.providerData, and only
// type aliases are assignable to Prisma's JSON input type.
export type BankTransferInstructions = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  amount: string;
  narration: string;
};

export type PaymentInitiation = {
  // The provider's hosted checkout (Paystack's authorization URL); null for the stub.
  authorizationUrl: string | null;
  bankTransfer: BankTransferInstructions | null;
};

/** One payment provider. Paystack will be a second implementation. */
export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  initiate(payment: Payment): Promise<PaymentInitiation>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
