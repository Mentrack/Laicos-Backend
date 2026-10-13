import { maskAccount } from '../utils/mask-account';

describe('maskAccount', () => {
  it('shows only the last four digits', () => {
    expect(maskAccount('0123456789')).toBe('******6789');
  });
});
