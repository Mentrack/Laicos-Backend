import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { SmtpTransport } from '../transports/smtp.transport';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const gmail = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'team@gmail.com',
  SMTP_PASS: 'app-password',
};

function transportWith(env: Record<string, string>) {
  return new SmtpTransport(new ConfigService(env));
}

describe('SmtpTransport', () => {
  const mailer = { sendMail: jest.fn(), verify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (createTransport as jest.Mock).mockReturnValue(mailer);
  });

  it('connects over TLS with the app password', () => {
    transportWith(gmail);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'team@gmail.com', pass: 'app-password' },
    });
  });

  it('connects without auth or TLS to a local catcher', () => {
    transportWith({
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1026',
      SMTP_USER: '',
      SMTP_PASS: '',
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1026,
      secure: false,
      auth: undefined,
    });
  });

  it('refuses a user without a password at boot', () => {
    expect(() => transportWith({ ...gmail, SMTP_PASS: '' })).toThrow(
      'SMTP_USER and SMTP_PASS',
    );
  });

  it('refuses a non-numeric port at boot', () => {
    expect(() => transportWith({ ...gmail, SMTP_PORT: 'smtp' })).toThrow(
      'SMTP_PORT',
    );
  });

  it('sends the message through sendMail', async () => {
    await transportWith(gmail).send(
      'LAICOS <team@gmail.com>',
      'ada@example.com',
      { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' },
    );
    expect(mailer.sendMail).toHaveBeenCalledWith({
      from: 'LAICOS <team@gmail.com>',
      to: 'ada@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('verifies the connection', async () => {
    await transportWith(gmail).verify();
    expect(mailer.verify).toHaveBeenCalled();
  });
});
