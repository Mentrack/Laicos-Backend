import { Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationType,
  Role,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationQueue } from '../notification-queue';
import { NotificationService } from '../notification.service';

const params = { orderId: 'o1', produceName: 'Maize' };
const user = (id: string, firstName: string) => ({
  id,
  email: `${id}@example.com`,
  firstName,
  role: Role.FARMER,
});

type CreateCall = [
  { data: { deliveries: { create: { emailText?: string }[] } } },
];

describe('NotificationService', () => {
  const tx = {
    user: { findMany: jest.fn() },
    notification: { create: jest.fn() },
  };
  const database = {
    user: { findMany: jest.fn() },
    notification: { create: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const queue = { enqueue: jest.fn() };
  const service = new NotificationService(
    database as unknown as PrismaService,
    queue as unknown as NotificationQueue,
  );
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    database.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tx.user.findMany.mockResolvedValue([user('a', 'Ada')]);
    tx.notification.create.mockResolvedValue({
      deliveries: [{ id: 'd1' }, { id: 'd2' }],
    });
    queue.enqueue.mockResolvedValue(undefined);
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const input = (userIds: string[]) => ({
    userIds,
    type: NotificationType.ORDER_RECEIVED,
    params,
  });

  it('writes one inbox entry per recipient with a pending delivery per channel', async () => {
    const ids = await service.notify(input(['a']), tx as never);
    expect(ids).toEqual(['d1', 'd2']);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    const arg = (tx.notification.create.mock.calls as unknown[][])[0][0] as {
      data: {
        userId: string;
        type: string;
        title: string;
        body: string;
        data: unknown;
        deliveries: { create: Record<string, unknown>[] };
      };
      include: unknown;
    };
    expect(arg.include).toEqual({ deliveries: { select: { id: true } } });
    expect(arg.data).toMatchObject({
      userId: 'a',
      type: NotificationType.ORDER_RECEIVED,
      title: 'New order',
      data: { resource: 'ORDER', resourceId: 'o1' },
    });
    const [push, email] = arg.data.deliveries.create;
    expect(push).toEqual({ channel: NotificationChannel.PUSH });
    expect(email.channel).toBe(NotificationChannel.EMAIL);
    for (const field of ['emailSubject', 'emailHtml', 'emailText']) {
      expect(typeof email[field]).toBe('string');
    }
  });

  it('renders per recipient', async () => {
    tx.user.findMany.mockResolvedValue([user('a', 'Ada'), user('b', 'Bola')]);
    await service.notify(input(['a', 'b']), tx as never);
    const calls = tx.notification.create.mock.calls as CreateCall[];
    const texts = calls.map(
      (
        call: [{ data: { deliveries: { create: { emailText?: string }[] } } }],
      ) => call[0].data.deliveries.create[1].emailText,
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]).not.toEqual(texts[1]);
  });

  it('skips duplicate and unknown user ids without throwing', async () => {
    await service.notify(input(['a', 'a', 'ghost']), tx as never);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
  });

  it('does nothing for an empty list', async () => {
    await expect(service.notify(input([]), tx as never)).resolves.toEqual([]);
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(database.user.findMany).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('writes inside the caller transaction and leaves enqueueing to the caller', async () => {
    await service.notify(input(['a']), tx as never);
    expect(tx.notification.create).toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues after its own commit when no transaction is passed', async () => {
    const ids = await service.notify(input(['a']));
    await flush();
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(['d1', 'd2']);
    expect(ids).toEqual(['d1', 'd2']);
  });

  it('does not wait for a stalled queue before returning', async () => {
    queue.enqueue.mockReturnValue(new Promise(() => {}));
    await expect(service.notify(input(['a']))).resolves.toEqual(['d1', 'd2']);
  });

  it('does not throw when Redis is down; the sweep recovers', async () => {
    queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.notify(input(['a']))).resolves.toEqual(['d1', 'd2']);
    await flush();
    expect(error).toHaveBeenCalled();
  });
});
