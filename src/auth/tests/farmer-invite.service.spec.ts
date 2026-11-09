import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { FarmerInviteService } from '../farmer-invite.service';

const user = {
  id: 'user-1',
  email: 'ada@example.com',
  firstName: 'Ada',
} as User;

describe('FarmerInviteService', () => {
  const mail = { send: jest.fn() };
  const service = new FarmerInviteService(
    new ConfigService({ FRONTEND_WEBAPP_URL: 'https://app.laicos.ng' }),
    mail as unknown as MailService,
  );

  beforeEach(() => jest.clearAllMocks());

  function sent() {
    const [[to, email]] = mail.send.mock.calls as [
      [string, { subject: string; html: string; text: string }],
    ];
    return { to, ...email };
  }

  it('emails a set-password link on the webapp', async () => {
    await service.sendInvite(
      user,
      'https://laicos.firebaseapp.com/__/auth/action?oobCode=abc',
    );
    const email = sent();
    expect(email.to).toBe('ada@example.com');
    expect(email.html).toContain(
      'https://app.laicos.ng/reset-password?oobCode=abc',
    );
    expect(email.text).not.toMatch(/temporary password/i);
  });

  it('tells someone who already signs in that they have full access', async () => {
    await service.sendInvite(user, null);
    expect(sent().text).toContain(
      'You have been verified and have full access',
    );
    expect(sent().text).not.toMatch(/temporary password/i);
  });

  it('emails the rejection reason for the farm', async () => {
    await service.sendRejection(user, 'Green Acres', 'No farm at the address');
    expect(sent().subject).toContain('Green Acres');
    expect(sent().text).toContain('No farm at the address');
  });
});
