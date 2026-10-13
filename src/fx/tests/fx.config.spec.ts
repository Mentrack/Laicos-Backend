import { ConfigService } from '@nestjs/config';
import { FxConfig } from '../fx.config';

describe('FxConfig', () => {
  it('defaults the age limit and margin', () => {
    const config = new FxConfig(
      new ConfigService({ OPEN_EXCHANGE_RATES_APP_ID: 'app-id' }),
    );
    expect(config.appId).toBe('app-id');
    expect(config.maxAgeHours).toBe(6);
    expect(config.marginPercent.toFixed(2)).toBe('0.00');
  });

  it('refuses to boot without an app id', () => {
    expect(() => new FxConfig(new ConfigService({}))).toThrow(
      'OPEN_EXCHANGE_RATES_APP_ID',
    );
  });

  it.each([
    ['FX_MAX_AGE_HOURS', '0'],
    ['FX_MARGIN_PERCENT', '51'],
    ['FX_MARGIN_PERCENT', '-1'],
  ])('refuses %s=%p', (key, value) => {
    expect(
      () =>
        new FxConfig(
          new ConfigService({ OPEN_EXCHANGE_RATES_APP_ID: 'x', [key]: value }),
        ),
    ).toThrow(key);
  });
});
