import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auth } from '@googleapis/gmail';
import { PermanentSendError } from '../../common/permanent-send-error';
import { GmailApiTransport } from '../transports/gmail-api.transport';

const send = jest.fn();
const getAccessToken = jest.fn<Promise<{ token: string }>, []>();

jest.mock('@googleapis/gmail', () => {
  const OAuth2 = jest.fn().mockImplementation(() => ({
    setCredentials: jest.fn(),
    getAccessToken: () => getAccessToken(),
  }));
  return {
    auth: { OAuth2 },
    gmail: () => ({ users: { messages: { send } } }),
  };
});

const env = {
  GMAIL_CLIENT_ID: 'client-id',
  GMAIL_CLIENT_SECRET: 'client-secret',
  GMAIL_REFRESH_TOKEN: 'refresh-token',
};
const email = { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

function transportWith(values: Record<string, string>) {
  return new GmailApiTransport(new ConfigService(values));
}

describe('GmailApiTransport', () => {
  let logged: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({});
    getAccessToken.mockResolvedValue({ token: 't' });
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => logged.mockRestore());

  it.each(Object.keys(env))(
    'refuses missing Gmail credentials at boot (%s)',
    (key) => {
      expect(() => transportWith({ ...env, [key]: '' })).toThrow(key);
    },
  );

  it('sends a base64url MIME message as me', async () => {
    await transportWith(env).send(
      'LAICOS <team@gmail.com>',
      'ada@example.com',
      email,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [params] = send.mock.calls[0] as [
      { userId: string; requestBody: { raw: string } },
    ];
    expect(params.userId).toBe('me');
    const mime = Buffer.from(params.requestBody.raw, 'base64url').toString();
    expect(mime).toContain('To: ada@example.com');
    expect(mime).toContain('Subject: Hi');
    expect(mime).toContain('text/plain');
    expect(mime).toContain('text/html');
  });

  it('bounds the send request with a timeout', async () => {
    await transportWith(env).send('a@b.c', 'ada@example.com', email);
    expect(send).toHaveBeenCalledWith(expect.anything(), {
      timeout: expect.any(Number),
    });
  });

  it('bounds the token refresh with a timeout', () => {
    transportWith(env);
    expect(auth.OAuth2).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      transporterOptions: { timeout: expect.any(Number) },
    });
  });

  it.each([{ status: 400 }, { response: { status: 400 } }])(
    'treats a 400 as permanent (%j)',
    async (failure) => {
      send.mockRejectedValueOnce(Object.assign(new Error('bad'), failure));
      await expect(
        transportWith(env).send('a@b.c', 'ada@example.com', email),
      ).rejects.toBeInstanceOf(PermanentSendError);
    },
  );

  it.each([401, 403, 429, 500, 503])(
    'treats %i as temporary',
    async (status) => {
      const failure = Object.assign(new Error('nope'), { status });
      send.mockRejectedValueOnce(failure);
      await expect(
        transportWith(env).send('a@b.c', 'ada@example.com', email),
      ).rejects.toBe(failure);
    },
  );

  it('logs a 401/403 as a likely revoked refresh token', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 401 }),
    );
    await expect(
      transportWith(env).send('a@b.c', 'ada@example.com', email),
    ).rejects.toThrow('nope');
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('refresh token'),
    );
  });

  it('treats a token-fetch 400 (invalid_grant) as temporary and logs it', async () => {
    const failure = Object.assign(new Error('invalid_grant'), { status: 400 });
    getAccessToken.mockRejectedValueOnce(failure);
    await expect(
      transportWith(env).send('a@b.c', 'ada@example.com', email),
    ).rejects.toBe(failure);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('refresh token'),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('verifies by fetching an access token', async () => {
    getAccessToken.mockResolvedValue({ token: 't' });
    await transportWith(env).verify();
    expect(getAccessToken).toHaveBeenCalled();
  });
});
