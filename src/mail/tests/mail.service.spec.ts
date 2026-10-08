import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService } from '../mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const gmail = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'team@gmail.com',
  SMTP_PASS: 'app-password',
  MAIL_FROM: 'LAICOS <team@gmail.com>',
};

function serviceWith(env: Record<string, string>) {
  return new MailService(new ConfigService(env));
}

describe('MailService', () => {
  const transport = { sendMail: jest.fn(), verify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (createTransport as jest.Mock).mockReturnValue(transport);
  });

  it('connects to Gmail over TLS with the app password', () => {
    serviceWith(gmail);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'team@gmail.com', pass: 'app-password' },
    });
  });

  it('connects without auth or TLS to a local catcher', () => {
    serviceWith({
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1026',
      SMTP_USER: '',
      SMTP_PASS: '',
      MAIL_FROM: 'LAICOS <dev@laicos.local>',
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1026,
      secure: false,
      auth: undefined,
    });
  });

  it('refuses a user without a password at boot', () => {
    expect(() => serviceWith({ ...gmail, SMTP_PASS: '' })).toThrow(
      'SMTP_USER and SMTP_PASS',
    );
  });

  it('refuses a missing sender at boot', () => {
    const { MAIL_FROM: _from, ...rest } = gmail;
    expect(() => serviceWith(rest)).toThrow();
  });

  it('refuses a non-numeric port at boot', () => {
    expect(() => serviceWith({ ...gmail, SMTP_PORT: 'smtp' })).toThrow(
      'SMTP_PORT',
    );
  });

  it('checks the credentials at boot', async () => {
    await serviceWith(gmail).onModuleInit();
    expect(transport.verify).toHaveBeenCalled();
  });

  it('boots anyway on rejected credentials, logging why', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    transport.verify.mockRejectedValueOnce(
      new Error('Invalid login: 535-5.7.8 Username and Password not accepted'),
    );
    await expect(serviceWith(gmail).onModuleInit()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Username and Password not accepted'),
    );
    error.mockRestore();
  });

  it('sends from the configured sender', async () => {
    await serviceWith(gmail).send('ada@example.com', {
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'LAICOS <team@gmail.com>',
      to: 'ada@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });
});
