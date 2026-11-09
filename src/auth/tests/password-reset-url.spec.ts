import { ConfigService } from '@nestjs/config';
import { passwordResetUrl } from '../utils/password-reset-url';

describe('passwordResetUrl', () => {
  const config = new ConfigService({
    FRONTEND_WEBAPP_URL: 'https://app.laicos.ng',
  });

  it('builds the webapp reset URL from the oobCode', () => {
    expect(
      passwordResetUrl(
        config,
        'https://x.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=a/b',
      ),
    ).toBe('https://app.laicos.ng/reset-password?oobCode=a%2Fb');
  });

  it('throws when the link has no oobCode', () => {
    expect(() =>
      passwordResetUrl(
        config,
        'https://x.firebaseapp.com/__/auth/action?mode=resetPassword',
      ),
    ).toThrow('Firebase reset link has no oobCode');
  });
});
