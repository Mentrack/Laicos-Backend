import { ConfigService } from '@nestjs/config';
import { PaystackConfig } from '../paystack.config';

const env = {
  PAYSTACK_SECRET_KEY: 'sk_test_secret',
  PAYSTACK_CALLBACK_URL: 'https://app.laicos.test/payments/callback',
};

describe('PaystackConfig', () => {
  it('reads the key and callback URL', () => {
    const config = new PaystackConfig(new ConfigService(env));
    expect(config.secretKey).toBe('sk_test_secret');
    expect(config.callbackUrl).toBe(env.PAYSTACK_CALLBACK_URL);
  });

  it.each(Object.keys(env))('refuses to boot without %s', (key) => {
    expect(
      () => new PaystackConfig(new ConfigService({ ...env, [key]: ' ' })),
    ).toThrow(key);
  });

  it('refuses a callback that is not a URL', () => {
    expect(
      () =>
        new PaystackConfig(
          new ConfigService({ ...env, PAYSTACK_CALLBACK_URL: 'not a url' }),
        ),
    ).toThrow('PAYSTACK_CALLBACK_URL');
  });
});
