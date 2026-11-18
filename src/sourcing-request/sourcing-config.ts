import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { wholeNumberConfig } from '../common/config';

/** Sourcing timers, read and validated once at boot. */
@Injectable()
export class SourcingConfig {
  readonly responseHours: number;
  readonly checkoutHoldHours: number;

  constructor(config: ConfigService) {
    this.responseHours = wholeNumberConfig(
      config,
      'SOURCING_RESPONSE_HOURS',
      1,
      24,
    );
    this.checkoutHoldHours = wholeNumberConfig(
      config,
      'SOURCING_CHECKOUT_HOLD_HOURS',
      1,
      48,
    );
  }
}
