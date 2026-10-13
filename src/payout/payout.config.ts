import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { wholeNumberConfig } from '../common/config';

@Injectable()
export class PayoutConfig {
  // Time after FULFILLED for the buyer to raise a problem before payout.
  readonly holdHours: number;

  constructor(config: ConfigService) {
    this.holdHours = wholeNumberConfig(config, 'PAYOUT_HOLD_HOURS', 0, 48);
  }
}
