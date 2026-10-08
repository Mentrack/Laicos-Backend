import { ConfigService } from '@nestjs/config';
import { CheckoutConfig } from '../checkout-config';

export const CHECKOUT_ENV = {
  DELIVERY_FEE: '3500',
  CHECKOUT_HOLD_MINUTES: '30',
  BANK_TRANSFER_HOLD_HOURS: '24',
  DELIVERY_MIN_DAYS: '1',
  DELIVERY_MAX_DAYS: '30',
  ESCROW_BANK_NAME: 'Test Bank',
  ESCROW_ACCOUNT_NAME: 'LAICOS Escrow',
  ESCROW_ACCOUNT_NUMBER: '0123456789',
};

export function testCheckoutConfig(
  overrides: Partial<Record<keyof typeof CHECKOUT_ENV, string>> = {},
) {
  return new CheckoutConfig(
    new ConfigService({ ...CHECKOUT_ENV, ...overrides }),
  );
}
