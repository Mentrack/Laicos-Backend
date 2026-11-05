import { ConfigService } from '@nestjs/config';
import { createMailTransport } from '../transports/create-mail-transport';
import { GmailApiTransport } from '../transports/gmail-api.transport';
import { SmtpTransport } from '../transports/smtp.transport';

jest.mock('../transports/gmail-api.transport', () => ({
  GmailApiTransport: jest.fn(),
}));
jest.mock('../transports/smtp.transport', () => ({
  SmtpTransport: jest.fn(),
}));

describe('createMailTransport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the Gmail API transport', () => {
    expect(
      createMailTransport(new ConfigService({ MAIL_TRANSPORT: 'gmail' })),
    ).toBeInstanceOf(GmailApiTransport);
  });

  it('builds the SMTP transport', () => {
    expect(
      createMailTransport(new ConfigService({ MAIL_TRANSPORT: 'smtp' })),
    ).toBeInstanceOf(SmtpTransport);
  });

  it('refuses a missing transport', () => {
    expect(() => createMailTransport(new ConfigService({}))).toThrow();
  });

  it('names the allowed values for an unknown transport', () => {
    expect(() =>
      createMailTransport(new ConfigService({ MAIL_TRANSPORT: 'ses' })),
    ).toThrow('MAIL_TRANSPORT must be gmail or smtp');
  });
});
