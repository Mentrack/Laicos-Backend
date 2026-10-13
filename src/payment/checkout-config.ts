import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/client';
import {
  percentConfig,
  requireConfig,
  wholeNumberConfig,
} from '../common/config';

/** Checkout settings, read and validated once at boot. */
@Injectable()
export class CheckoutConfig {
  readonly deliveryFee: Prisma.Decimal;
  readonly serviceFeePercent: Prisma.Decimal;
  readonly holdMinutes: number;
  readonly deliveryMinDays: number;
  readonly deliveryMaxDays: number;

  constructor(config: ConfigService) {
    this.deliveryFee = naira(config, 'DELIVERY_FEE');
    this.serviceFeePercent = percentConfig(config, 'SERVICE_FEE_PERCENT', 100);
    this.holdMinutes = wholeNumberConfig(config, 'CHECKOUT_HOLD_MINUTES', 1);
    this.deliveryMinDays = wholeNumberConfig(config, 'DELIVERY_MIN_DAYS', 0);
    this.deliveryMaxDays = wholeNumberConfig(config, 'DELIVERY_MAX_DAYS', 1);
    if (this.deliveryMinDays > this.deliveryMaxDays) {
      throw new Error('DELIVERY_MIN_DAYS must not exceed DELIVERY_MAX_DAYS');
    }
  }
}

function naira(config: ConfigService, key: string) {
  const value = requireConfig(config, key);
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`${key} must be a naira amount with at most 2 decimals`);
  }
  return new Prisma.Decimal(value);
}
