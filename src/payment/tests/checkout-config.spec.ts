import { CHECKOUT_ENV, testCheckoutConfig } from './checkout-config.fixture';

describe('CheckoutConfig', () => {
  it('reads every value', () => {
    const config = testCheckoutConfig({ DELIVERY_FEE: '3500.50' });
    expect(config.deliveryFee.toFixed(2)).toBe('3500.50');
    expect(config.holdMinutes).toBe(30);
    expect(config.bankTransferHoldHours).toBe(24);
    expect(config.deliveryMinDays).toBe(1);
    expect(config.deliveryMaxDays).toBe(30);
    expect(config.escrow).toEqual({
      bankName: 'Test Bank',
      accountName: 'LAICOS Escrow',
      accountNumber: '0123456789',
    });
  });

  it('allows a zero fee and same-day delivery', () => {
    const config = testCheckoutConfig({
      DELIVERY_FEE: '0',
      DELIVERY_MIN_DAYS: '0',
    });
    expect(config.deliveryFee.toFixed(2)).toBe('0.00');
    expect(config.deliveryMinDays).toBe(0);
  });

  it.each(Object.keys(CHECKOUT_ENV))('refuses to boot without %s', (key) => {
    expect(() => testCheckoutConfig({ [key]: '  ' })).toThrow(key);
  });

  it.each([
    ['DELIVERY_FEE', '-1'],
    ['DELIVERY_FEE', '12.345'],
    ['DELIVERY_FEE', 'abc'],
    ['CHECKOUT_HOLD_MINUTES', '0'],
    ['CHECKOUT_HOLD_MINUTES', '1.5'],
    ['BANK_TRANSFER_HOLD_HOURS', '0'],
    ['DELIVERY_MIN_DAYS', '-1'],
    ['DELIVERY_MAX_DAYS', '0'],
  ])('refuses %s=%p', (key, value) => {
    expect(() => testCheckoutConfig({ [key]: value })).toThrow(key);
  });

  it('refuses a minimum after the maximum', () => {
    expect(() =>
      testCheckoutConfig({ DELIVERY_MIN_DAYS: '10', DELIVERY_MAX_DAYS: '5' }),
    ).toThrow('DELIVERY_MIN_DAYS');
  });
});
