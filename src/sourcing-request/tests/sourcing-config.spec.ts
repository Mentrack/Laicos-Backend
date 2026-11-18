import { ConfigService } from '@nestjs/config';
import { SourcingConfig } from '../sourcing-config';

const build = (env: Record<string, string> = {}) =>
  new SourcingConfig(new ConfigService(env));

describe('SourcingConfig', () => {
  it('defaults to a 24h response window and a 48h checkout hold', () => {
    const config = build();
    expect(config.responseHours).toBe(24);
    expect(config.checkoutHoldHours).toBe(48);
  });

  it('reads both windows from the environment', () => {
    const config = build({
      SOURCING_RESPONSE_HOURS: '12',
      SOURCING_CHECKOUT_HOLD_HOURS: '72',
    });
    expect(config.responseHours).toBe(12);
    expect(config.checkoutHoldHours).toBe(72);
  });

  it.each(['0', 'abc', '1.5'])('refuses %s', (value) => {
    expect(() => build({ SOURCING_RESPONSE_HOURS: value })).toThrow(
      'SOURCING_RESPONSE_HOURS',
    );
    expect(() => build({ SOURCING_CHECKOUT_HOLD_HOURS: value })).toThrow(
      'SOURCING_CHECKOUT_HOLD_HOURS',
    );
  });
});
