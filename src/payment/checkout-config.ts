import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/client';
import { requireConfig } from '../common/config';

/** Checkout and payment settings, read and validated once at boot. */
@Injectable()
export class CheckoutConfig {
  readonly deliveryFee: Prisma.Decimal;
  readonly holdMinutes: number;
  readonly bankTransferHoldHours: number;
  readonly deliveryMinDays: number;
  readonly deliveryMaxDays: number;
  readonly escrow: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  };

  constructor(config: ConfigService) {
    this.deliveryFee = naira(config, 'DELIVERY_FEE');
    this.holdMinutes = wholeNumber(config, 'CHECKOUT_HOLD_MINUTES', 1);
    this.bankTransferHoldHours = wholeNumber(
      config,
      'BANK_TRANSFER_HOLD_HOURS',
      1,
    );
    this.deliveryMinDays = wholeNumber(config, 'DELIVERY_MIN_DAYS', 0);
    this.deliveryMaxDays = wholeNumber(config, 'DELIVERY_MAX_DAYS', 1);
    if (this.deliveryMinDays > this.deliveryMaxDays) {
      throw new Error('DELIVERY_MIN_DAYS must not exceed DELIVERY_MAX_DAYS');
    }
    this.escrow = {
      bankName: requireConfig(config, 'ESCROW_BANK_NAME'),
      accountName: requireConfig(config, 'ESCROW_ACCOUNT_NAME'),
      accountNumber: requireConfig(config, 'ESCROW_ACCOUNT_NUMBER'),
    };
  }
}

function wholeNumber(config: ConfigService, key: string, min: number) {
  const value = Number(requireConfig(config, key));
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be a whole number of at least ${min}`);
  }
  return value;
}

function naira(config: ConfigService, key: string) {
  const value = requireConfig(config, key);
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`${key} must be a naira amount with at most 2 decimals`);
  }
  return new Prisma.Decimal(value);
}
