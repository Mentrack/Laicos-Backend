import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import { Role, type User } from '../../../generated/client';
import type { FirebaseService } from '../../auth/firebase/firebase.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CHAT_EVENTS, ChatGateway } from '../chat.gateway';

// jest.mock is hoisted; its factory may only close over `mock`-prefixed names.
const mockRedis = { duplicate: jest.fn(), quit: jest.fn(), on: jest.fn() };
jest.mock('ioredis', () => ({ Redis: jest.fn(() => mockRedis) }));
jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => 'redis-adapter'),
}));

type Middleware = (socket: Socket, next: (error?: Error) => void) => void;

const buyer = {
  id: 'buyer-1',
  role: Role.BUYER,
  isVerified: true,
  activatedAt: null,
  mustChangePassword: false,
} as User;

describe('ChatGateway', () => {
  const verifyIdToken = jest.fn();
  const findUnique = jest.fn();
  const emit = jest.fn();
  const namespace = {
    server: { adapter: jest.fn() },
    use: jest.fn(),
    to: jest.fn(() => ({ emit })),
  };
  const config = new ConfigService({
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6380',
    REDIS_PASSWORD: 'secret',
  });
  let gateway: ChatGateway;
  let middleware: Middleware;

  function fakeSocket(token?: unknown) {
    const handlers = new Map<string, () => void>();
    return {
      // arguments.length distinguishes omitted (valid token) from explicit undefined.
      handshake: { auth: { token: arguments.length === 0 ? 'token' : token } },
      join: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn((event: string, handler: () => void) =>
        handlers.set(event, handler),
      ),
      fire: (event: string) => handlers.get(event)?.(),
    };
  }

  function connect(socket: ReturnType<typeof fakeSocket>) {
    return new Promise<Error | undefined>((resolve) =>
      middleware(socket as unknown as Socket, resolve),
    );
  }

  function inSeconds(seconds: number) {
    return Math.floor(Date.now() / 1000) + seconds;
  }

  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.duplicate.mockReturnValue(mockRedis);
    mockRedis.quit.mockResolvedValue('OK');
    verifyIdToken.mockResolvedValue({ uid: 'uid-1', exp: inSeconds(3600) });
    findUnique.mockResolvedValue(buyer);
    gateway = new ChatGateway(
      { auth: { verifyIdToken } } as unknown as FirebaseService,
      { user: { findUnique } } as unknown as PrismaService,
      config,
    );
    gateway.afterInit(namespace as unknown as Namespace);
    const registered: unknown = namespace.use.mock.calls[0]?.[0];
    middleware = registered as Middleware;
  });

  afterEach(() => jest.useRealTimers());

  it('attaches the Redis adapter so replicas share rooms', () => {
    expect(namespace.server.adapter).toHaveBeenCalledWith('redis-adapter');
  });

  it('joins a valid buyer to their user room', async () => {
    const socket = fakeSocket();
    await expect(connect(socket)).resolves.toBeUndefined();
    expect(verifyIdToken).toHaveBeenCalledWith('token', true);
    expect(socket.join).toHaveBeenCalledWith('user:buyer-1');
  });

  it.each([
    ['no token', undefined, 'Missing token', 'UNAUTHENTICATED'],
    ['a blank token', '', 'Missing token', 'UNAUTHENTICATED'],
  ])('refuses %s', async (_label, token, message, code) => {
    const error = await connect(fakeSocket(token));
    expect(error?.message).toBe(message);
    expect(error).toMatchObject({ data: { code, statusCode: 401 } });
  });

  it('refuses an invalid or revoked token', async () => {
    verifyIdToken.mockRejectedValue(new Error('revoked'));
    const error = await connect(fakeSocket());
    expect(error?.message).toBe('Invalid or expired token');
  });

  it.each([
    ['an unregistered user', null, 'FORBIDDEN'],
    [
      'an agent awaiting verification',
      { ...buyer, role: Role.EXTENSION_AGENT },
      'VERIFICATION_PENDING',
    ],
    [
      'a buyer with an unverified email',
      { ...buyer, isVerified: false },
      'EMAIL_NOT_VERIFIED',
    ],
    [
      'a user who must change password',
      { ...buyer, mustChangePassword: true },
      'PASSWORD_CHANGE_REQUIRED',
    ],
    [
      'a farmer',
      { ...buyer, role: Role.FARMER, activatedAt: new Date() },
      'FORBIDDEN',
    ],
  ])('refuses %s', async (_label, user, code) => {
    findUnique.mockResolvedValue(user);
    const socket = fakeSocket();
    const error = await connect(socket);
    expect(error).toMatchObject({ data: { code, statusCode: 403 } });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects when the token expires', async () => {
    jest.useFakeTimers();
    verifyIdToken.mockResolvedValue({ uid: 'uid-1', exp: inSeconds(60) });
    const socket = fakeSocket();
    await connect(socket);
    jest.advanceTimersByTime(59_000);
    expect(socket.disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects at once when the token is already past its expiry', async () => {
    jest.useFakeTimers();
    verifyIdToken.mockResolvedValue({ uid: 'uid-1', exp: inSeconds(-5) });
    const socket = fakeSocket();
    await connect(socket);
    jest.advanceTimersByTime(0);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('clears the expiry timer when the socket leaves', async () => {
    jest.useFakeTimers();
    verifyIdToken.mockResolvedValue({ uid: 'uid-1', exp: inSeconds(60) });
    const socket = fakeSocket();
    await connect(socket);
    socket.fire('disconnect');
    jest.advanceTimersByTime(120_000);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it("emits to each participant's room", () => {
    gateway.emitToUsers(['buyer-1', 'agent-1'], CHAT_EVENTS.messageCreated, {
      id: 'msg-1',
    });
    expect(namespace.to).toHaveBeenCalledWith(['user:buyer-1', 'user:agent-1']);
    expect(emit).toHaveBeenCalledWith('message.created', { id: 'msg-1' });
  });

  it('never lets a failed emit escape', () => {
    namespace.to.mockImplementationOnce(() => {
      throw new Error('redis down');
    });
    expect(() =>
      gateway.emitToUsers(['buyer-1'], CHAT_EVENTS.messageCreated, {}),
    ).not.toThrow();
  });

  it('closes both Redis connections on shutdown', async () => {
    await gateway.onApplicationShutdown();
    expect(mockRedis.quit).toHaveBeenCalledTimes(2);
  });
});
