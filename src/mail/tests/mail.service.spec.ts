import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail.service';

const env = { MAIL_FROM: 'LAICOS <team@gmail.com>' };
const email = { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

describe('MailService', () => {
  const transport = { send: jest.fn(), verify: jest.fn() };
  const serviceWith = (values: Record<string, string>) =>
    new MailService(new ConfigService(values), transport);

  beforeEach(() => jest.clearAllMocks());

  it('sends from the configured sender', async () => {
    await serviceWith(env).send('ada@example.com', email);
    expect(transport.send).toHaveBeenCalledWith(
      'LAICOS <team@gmail.com>',
      'ada@example.com',
      email,
    );
  });

  it('refuses a missing sender at boot', () => {
    expect(() => serviceWith({})).toThrow();
  });

  it('checks the transport at boot', async () => {
    await serviceWith(env).onModuleInit();
    expect(transport.verify).toHaveBeenCalled();
  });

  it('boots anyway on a failed check, logging why', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    transport.verify.mockRejectedValueOnce(new Error('Invalid login'));
    await expect(serviceWith(env).onModuleInit()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid login'),
    );
    error.mockRestore();
  });
});
