import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/client';
import {
  percentConfig,
  requireConfig,
  wholeNumberConfig,
} from '../common/config';

@Injectable()
export class FxConfig {
  readonly appId: string;
  // A USD payment is refused once the newest rate is older than this.
  readonly maxAgeHours: number;
  // Taken off the market rate to cover converting USD back to NGN for payouts.
  readonly marginPercent: Prisma.Decimal;

  constructor(config: ConfigService) {
    this.appId = requireConfig(config, 'OPEN_EXCHANGE_RATES_APP_ID');
    this.maxAgeHours = wholeNumberConfig(config, 'FX_MAX_AGE_HOURS', 1, 6);
    this.marginPercent = percentConfig(config, 'FX_MARGIN_PERCENT', 50, '0');
  }
}
