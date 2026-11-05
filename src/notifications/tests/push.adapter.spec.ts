import { ConfigService } from '@nestjs/config';
import { Expo } from 'expo-server-sdk';
import { Agent } from 'undici';
import { PermanentSendError } from '../../common/permanent-send-error';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryTarget } from '../channels/channel-adapter';
import { ExpoPushAdapter } from '../channels/push.adapter';

jest.mock('expo-server-sdk');
jest.mock('undici');

const target: DeliveryTarget = {
  userId: 'u1',
  email: 'ada@example.com',
  title: 'Title',
  body: 'Body',
  data: { orderId: 'o1' },
  emailSubject: null,
  emailHtml: null,
  emailText: null,
};

const ok = { status: 'ok', id: 'r1' };
const failed = (error: string) => ({
  status: 'error',
  message: error,
  details: { error },
});

describe('ExpoPushAdapter', () => {
  const send = jest.fn();
  const chunk = jest.fn();
  const database = {
    pushDevice: { findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const config = { get: jest.fn() };
  const build = () =>
    new ExpoPushAdapter(
      config as unknown as ConfigService,
      database as unknown as PrismaService,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(Expo).mockImplementation(
      () =>
        ({
          chunkPushNotifications: chunk,
          sendPushNotificationsAsync: send,
        }) as unknown as Expo,
    );
    chunk.mockImplementation((messages: unknown[]) => [messages]);
    database.pushDevice.findMany.mockResolvedValue([
      { token: 'tok-a' },
      { token: 'tok-b' },
    ]);
  });

  it('skips a user with no devices', async () => {
    database.pushDevice.findMany.mockResolvedValue([]);
    await expect(build().send(target)).resolves.toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends title, body, data and the default sound to every token', async () => {
    send.mockResolvedValue([ok, ok]);
    await expect(build().send(target)).resolves.toBe('SENT');
    expect(send).toHaveBeenCalledWith([
      {
        to: 'tok-a',
        title: 'Title',
        body: 'Body',
        data: { orderId: 'o1' },
        sound: 'default',
      },
      {
        to: 'tok-b',
        title: 'Title',
        body: 'Body',
        data: { orderId: 'o1' },
        sound: 'default',
      },
    ]);
  });

  it('is sent when at least one token is accepted, even if others fail', async () => {
    send.mockResolvedValue([ok, failed('MessageTooBig')]);
    await expect(build().send(target)).resolves.toBe('SENT');
  });

  it('deletes tokens Expo says are no longer registered', async () => {
    send.mockResolvedValue([ok, failed('DeviceNotRegistered')]);
    await build().send(target);
    expect(database.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['tok-b'] } },
    });
  });

  it('skips when every token turned out to be unregistered', async () => {
    send.mockResolvedValue([
      failed('DeviceNotRegistered'),
      failed('DeviceNotRegistered'),
    ]);
    await expect(build().send(target)).resolves.toBe('SKIPPED');
    expect(database.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['tok-a', 'tok-b'] } },
    });
  });

  it('retries when Expo was unreachable', async () => {
    send.mockRejectedValue(new Error('network down'));
    const result = build().send(target);
    await expect(result).rejects.toThrow('network down');
    await expect(result).rejects.not.toBeInstanceOf(PermanentSendError);
  });

  it('retries when nothing was accepted and Expo was rate limiting', async () => {
    send.mockResolvedValue([failed('MessageRateExceeded')]);
    database.pushDevice.findMany.mockResolvedValue([{ token: 'tok-a' }]);
    const result = build().send(target);
    await expect(result).rejects.toBeInstanceOf(Error);
    await expect(result).rejects.not.toBeInstanceOf(PermanentSendError);
  });

  it.each(['ExpoError', 'ProviderError'])(
    'treats a %s ticket as transient',
    async (error) => {
      send.mockResolvedValue([failed(error), failed(error)]);
      const result = build().send(target);
      await expect(result).rejects.toBeInstanceOf(Error);
      await expect(result).rejects.not.toBeInstanceOf(PermanentSendError);
    },
  );

  describe('with two chunks', () => {
    beforeEach(() => {
      chunk.mockImplementation((messages: unknown[]) =>
        messages.map((m) => [m]),
      );
    });

    it('is sent, and prunes dead tokens, when a later chunk fails', async () => {
      database.pushDevice.findMany.mockResolvedValue([
        { token: 'tok-a' },
        { token: 'tok-b' },
        { token: 'tok-c' },
      ]);
      send
        .mockResolvedValueOnce([failed('DeviceNotRegistered')])
        .mockResolvedValueOnce([ok])
        .mockRejectedValueOnce(new Error('network down'));
      await expect(build().send(target)).resolves.toBe('SENT');
      expect(database.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['tok-a'] } },
      });
    });

    it('rethrows the original error when nothing was accepted', async () => {
      const boom = new Error('network down');
      send
        .mockResolvedValueOnce([failed('DeviceNotRegistered')])
        .mockRejectedValueOnce(boom);
      await expect(build().send(target)).rejects.toBe(boom);
      expect(database.pushDevice.deleteMany).toHaveBeenCalled();
    });
  });

  it('fails permanently when every token was rejected for another reason', async () => {
    send.mockResolvedValue([
      failed('InvalidCredentials'),
      failed('InvalidCredentials'),
    ]);
    await expect(build().send(target)).rejects.toBeInstanceOf(
      PermanentSendError,
    );
  });

  it('passes EXPO_ACCESS_TOKEN only when set', () => {
    config.get.mockReturnValue('  secret ');
    build();
    expect(Expo).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: 'secret' }),
    );

    config.get.mockReturnValue('   ');
    build();
    expect(Expo).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ accessToken: expect.anything() }),
    );
  });

  it('sends through an agent with connect, header and body timeouts', () => {
    build();
    expect(Agent).toHaveBeenCalledWith({
      connectTimeout: expect.any(Number),
      headersTimeout: expect.any(Number),
      bodyTimeout: expect.any(Number),
    });
    expect(Expo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        httpAgent: jest.mocked(Agent).mock.instances[0],
      }),
    );
  });
});
