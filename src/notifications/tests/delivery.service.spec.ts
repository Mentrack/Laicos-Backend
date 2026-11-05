import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { PermanentSendError } from '../../common/permanent-send-error';
import { DeliveryService } from '../delivery.service';

describe('DeliveryService', () => {
  const prisma = {
    notificationDelivery: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const push = { send: jest.fn() };
  const email = { send: jest.fn() };
  const queue = { enqueue: jest.fn() };
  const service = new DeliveryService(
    prisma as never,
    push as never,
    email as never,
    queue as never,
  );

  const delivery = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    channel: 'PUSH',
    status: 'PENDING',
    emailSubject: null,
    emailHtml: null,
    emailText: null,
    notification: {
      userId: 'u1',
      title: 'T',
      body: 'B',
      data: { a: 1 },
      user: { email: 'u@x.com' },
    },
    ...over,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
  });

  it('does nothing for a delivery that is missing or no longer pending', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValueOnce(null);
    await service.deliver('d1', false);
    for (const status of ['SENT', 'SKIPPED', 'FAILED']) {
      prisma.notificationDelivery.findUnique.mockResolvedValueOnce(
        delivery({ status }),
      );
      await service.deliver('d1', false);
    }
    expect(push.send).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('marks a sent delivery SENT with sentAt and one more attempt', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    push.send.mockResolvedValue('SENT');
    await service.deliver('d1', false);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'PENDING' },
      data: {
        status: 'SENT',
        sentAt: expect.any(Date) as Date,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  });

  it('marks a skipped delivery SKIPPED', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    push.send.mockResolvedValue('SKIPPED');
    await service.deliver('d1', false);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'PENDING' },
      data: { status: 'SKIPPED', attempts: { increment: 1 }, lastError: null },
    });
  });

  it('routes PUSH to the push adapter and EMAIL to the email adapter', async () => {
    push.send.mockResolvedValue('SENT');
    email.send.mockResolvedValue('SENT');
    prisma.notificationDelivery.findUnique.mockResolvedValueOnce(delivery());
    await service.deliver('d1', false);
    expect(push.send).toHaveBeenCalledWith({
      userId: 'u1',
      email: 'u@x.com',
      title: 'T',
      body: 'B',
      data: { a: 1 },
      emailSubject: null,
      emailHtml: null,
      emailText: null,
    });
    expect(email.send).not.toHaveBeenCalled();

    prisma.notificationDelivery.findUnique.mockResolvedValueOnce(
      delivery({
        channel: 'EMAIL',
        emailSubject: 'S',
        emailHtml: '<p>h</p>',
        emailText: 'h',
      }),
    );
    await service.deliver('d1', false);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        emailSubject: 'S',
        emailHtml: '<p>h</p>',
        emailText: 'h',
      }),
    );
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('records a temporary error and rethrows it, leaving the delivery pending', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    const err = new Error('boom');
    push.send.mockRejectedValue(err);
    await expect(service.deliver('d1', false)).rejects.toBe(err);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'PENDING' },
      data: { attempts: { increment: 1 }, lastError: 'boom' },
    });
  });

  it('marks FAILED on the final attempt', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    const err = new Error('boom');
    push.send.mockRejectedValue(err);
    await expect(service.deliver('d1', true)).rejects.toBe(err);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'PENDING' },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: 'boom',
      },
    });
  });

  it('does not mark a delivered message FAILED when the success write fails', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    push.send.mockResolvedValue('SENT');
    const dbError = new Error('db down');
    prisma.notificationDelivery.updateMany.mockRejectedValue(dbError);
    await expect(service.deliver('d1', true)).rejects.toBe(dbError);
    const calls = prisma.notificationDelivery.updateMany.mock.calls as [
      { data: { status?: string } },
    ][];
    expect(calls).toHaveLength(1);
    expect(calls.some(([arg]) => arg.data.status === 'FAILED')).toBe(false);
  });

  it('marks FAILED at once and throws UnrecoverableError on a permanent error', async () => {
    prisma.notificationDelivery.findUnique.mockResolvedValue(delivery());
    push.send.mockRejectedValue(new PermanentSendError('bad recipient'));
    await expect(service.deliver('d1', false)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'PENDING' },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: 'bad recipient',
      },
    });
  });

  it('sweeps pending deliveries older than five minutes, oldest first', async () => {
    const now = new Date('2026-11-04T12:00:00Z');
    prisma.notificationDelivery.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    const count = await service.sweep(now);
    expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(now.getTime() - 300000) },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(['a', 'b']);
    expect(count).toBe(2);
  });

  describe('admin dead-letter', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'd1',
      channel: 'EMAIL',
      status: 'FAILED',
      attempts: 5,
      lastError: 'boom',
      sentAt: null,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-02T00:00:00Z'),
      notification: {
        type: 'ORDER_PLACED',
        user: {
          id: 'u1',
          email: 'u@x.com',
          firstName: 'A',
          lastName: 'B',
          role: 'BUYER',
        },
      },
      ...over,
    });

    it('lists FAILED deliveries by default, newest update first, paginated', async () => {
      prisma.notificationDelivery.findMany.mockResolvedValue([row()]);
      prisma.notificationDelivery.count.mockResolvedValue(1);
      const result = await service.list({ page: 2, perPage: 10 });
      expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'FAILED' },
          orderBy: { updatedAt: 'desc' },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.metaData).toEqual({
        page: 2,
        perPage: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.data[0]).toEqual({
        id: 'd1',
        channel: 'EMAIL',
        status: 'FAILED',
        type: 'ORDER_PLACED',
        attempts: 5,
        lastError: 'boom',
        sentAt: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-02T00:00:00Z'),
        user: {
          id: 'u1',
          email: 'u@x.com',
          firstName: 'A',
          lastName: 'B',
          role: 'BUYER',
        },
      });
    });

    it('filters by an explicit status', async () => {
      prisma.notificationDelivery.findMany.mockResolvedValue([]);
      prisma.notificationDelivery.count.mockResolvedValue(0);
      await service.list({ status: 'SKIPPED' } as never);
      expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'SKIPPED' } }),
      );
    });

    it('retry throws NotFound for a missing delivery', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(null);
      await expect(service.retry('d1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('retry throws Conflict for a delivery that is not FAILED', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(
        row({ status: 'SENT' }),
      );
      await expect(service.retry('d1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
    });

    it('retry throws Conflict when another admin won the race', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(row());
      prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.retry('d1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('retry resets a FAILED delivery to PENDING, enqueues it and returns it', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(row());
      prisma.notificationDelivery.findUniqueOrThrow.mockResolvedValue(
        row({ status: 'PENDING', attempts: 0, lastError: null }),
      );
      const dto = await service.retry('d1');
      expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', status: 'FAILED' },
        data: { status: 'PENDING', attempts: 0, lastError: null },
      });
      expect(queue.enqueue).toHaveBeenCalledWith(['d1']);
      expect(dto.status).toBe('PENDING');
      expect(dto.attempts).toBe(0);
    });

    it('retry still returns the delivery when enqueueing fails; the sweep recovers it', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(row());
      prisma.notificationDelivery.findUniqueOrThrow.mockResolvedValue(
        row({ status: 'PENDING', attempts: 0, lastError: null }),
      );
      queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const dto = await service.retry('d1');
      expect(dto.status).toBe('PENDING');
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });
  });
});
