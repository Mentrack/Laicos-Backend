import { PermanentSendError } from '../../common/permanent-send-error';
import { MailService } from '../../mail/mail.service';
import { DeliveryTarget } from '../channels/channel-adapter';
import { EmailChannelAdapter } from '../channels/email.adapter';

const target: DeliveryTarget = {
  userId: 'u1',
  email: 'ada@example.com',
  title: 'T',
  body: 'B',
  data: null,
  emailSubject: 'Subject',
  emailHtml: '<p>hi</p>',
  emailText: 'hi',
};

describe('EmailChannelAdapter', () => {
  const mail = { send: jest.fn() };
  const adapter = new EmailChannelAdapter(mail as unknown as MailService);

  beforeEach(() => jest.resetAllMocks());

  it('sends the stored rendered email to the user', async () => {
    mail.send.mockResolvedValue(undefined);
    await expect(adapter.send(target)).resolves.toBe('SENT');
    expect(mail.send).toHaveBeenCalledWith('ada@example.com', {
      subject: 'Subject',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('skips a user without an email', async () => {
    await expect(adapter.send({ ...target, email: '' })).resolves.toBe(
      'SKIPPED',
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('fails permanently when the delivery has no rendered email', async () => {
    await expect(
      adapter.send({ ...target, emailHtml: null }),
    ).rejects.toBeInstanceOf(PermanentSendError);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('lets a PermanentSendError through', async () => {
    mail.send.mockRejectedValue(new PermanentSendError('bad recipient'));
    await expect(adapter.send(target)).rejects.toBeInstanceOf(
      PermanentSendError,
    );
  });
});
