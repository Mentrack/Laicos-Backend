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
      [string, { subject: string; text: string }],
    ];
    return { to, ...email };
  }

  it('emails the temporary password and the login link', async () => {
    await service.sendInvite(user, 'Tmp-Pass_123');
    const email = sent();
    expect(email.to).toBe('ada@example.com');
    expect(email.text).toContain('Tmp-Pass_123');
    expect(email.text).toContain('https://app.laicos.ng/login');
  });

  it('tells a Google farmer to sign in with Google', async () => {
    await service.sendInvite(user, null);
    expect(sent().text).toContain('Google');
    expect(sent().text).not.toMatch(/temporary password/i);
  });

  it('emails the rejection reason for the farm', async () => {
    await service.sendRejection(user, 'Green Acres', 'No farm at the address');
    expect(sent().subject).toContain('Green Acres');
    expect(sent().text).toContain('No farm at the address');
  });
});
