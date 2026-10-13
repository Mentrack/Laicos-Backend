import { ConfigService } from '@nestjs/config';
import { CheckoutConfig } from '../checkout-config';

export const CHECKOUT_ENV = {
  DELIVERY_FEE: '3500',
  SERVICE_FEE_PERCENT: '0',
  CHECKOUT_HOLD_MINUTES: '30',
  DELIVERY_MIN_DAYS: '1',
  DELIVERY_MAX_DAYS: '30',
};

export function testCheckoutConfig(
  overrides: Partial<Record<keyof typeof CHECKOUT_ENV, string>> = {},
) {
  return new CheckoutConfig(
    new ConfigService({ ...CHECKOUT_ENV, ...overrides }),
  );
}
