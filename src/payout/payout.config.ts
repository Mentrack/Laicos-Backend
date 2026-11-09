import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { wholeNumberConfig } from '../common/config';

@Injectable()
export class PayoutConfig {
  // Hours after the buyer confirms delivery: the dispute window, the payout
  // hold, and how long the buyer-agent chat stays writable.
  readonly holdHours: number;
  readonly runMinutes: number;

  constructor(config: ConfigService) {
    this.holdHours = wholeNumberConfig(config, 'PAYOUT_HOLD_HOURS', 0, 24);
    this.runMinutes = wholeNumberConfig(config, 'PAYOUT_RUN_MINUTES', 1, 60);
  }
}
