import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

describe('AuthService forgot password', () => {
  const user = { findUnique: jest.fn() };
  const firebase = { generatePasswordResetLink: jest.fn() };
  const mail = { send: jest.fn() };
  const service = new AuthService(
    { user } as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    new ConfigService({ FRONTEND_WEBAPP_URL: 'https://app.laicos.ng' }),
    mail as unknown as MailService,
    {} as EmailOtpService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    user.findUnique.mockResolvedValue({
      firstName: 'Ada',
      role: Role.BUYER,
      activatedAt: null,
    });
    firebase.generatePasswordResetLink.mockResolvedValue(
      'https://laicos.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc123&apiKey=key',
    );
  });

  it('emails a link to the webapp’s reset page carrying the code', async () => {
    await service.forgotPassword('ada@example.com');
    const [[to, email]] = mail.send.mock.calls as [[string, { text: string }]];
    expect(to).toBe('ada@example.com');
    expect(email.text).toContain(
      'https://app.laicos.ng/reset-password?oobCode=abc123',
    );
    expect(email.text).not.toContain('firebaseapp.com');
  });

  it('sends nothing for an unknown email', async () => {
    user.findUnique.mockResolvedValue(null);
    await service.forgotPassword('nobody@example.com');
    expect(mail.send).not.toHaveBeenCalled();
  });
});
