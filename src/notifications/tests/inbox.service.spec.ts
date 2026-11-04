import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { InboxService } from '../inbox.service';

describe('InboxService', () => {
  const row = {
    id: 'n-1',
    userId: 'user-1',
    type: NotificationType.ORDER_RECEIVED,
    title: 'New order',
    body: 'Body',
    data: { resource: 'ORDER', resourceId: 'o-1' },
    readAt: null,
    createdAt: new Date('2026-11-04T10:00:00Z'),
  };
  const notification = {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  };
  const service = new InboxService({
    notification,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    notification.findMany.mockResolvedValue([row]);
    notification.count.mockResolvedValue(1);
  });

  it('lists the user notifications newest first', async () => {
    const result = await service.list('user-1', { page: 2, perPage: 10 });
    expect(notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(result.data[0]).toMatchObject({ id: 'n-1', readAt: null });
    expect(result.metaData).toEqual({
      page: 2,
      perPage: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('narrows to unread rows on request', async () => {
    await service.list('user-1', { unread: true });
    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', readAt: null } }),
    );
  });

  it('counts unread notifications', async () => {
    notification.count.mockResolvedValue(3);
    await expect(service.unreadCount('user-1')).resolves.toEqual({ count: 3 });
    expect(notification.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
    });
  });

  it('marks only unread rows so a repeat keeps the first readAt', async () => {
    notification.updateMany.mockResolvedValue({ count: 1 });
    notification.findFirst.mockResolvedValue({
      ...row,
      readAt: new Date('2026-11-04T11:00:00Z'),
    });
    const dto = await service.markRead('user-1', 'n-1');
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-1', userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(dto.readAt).toEqual(new Date('2026-11-04T11:00:00Z'));
  });

  it('404s for a missing or another user notification', async () => {
    notification.updateMany.mockResolvedValue({ count: 0 });
    notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead('user-2', 'n-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'n-1', userId: 'user-2' },
    });
  });

  it('marks every unread notification read', async () => {
    notification.updateMany.mockResolvedValue({ count: 2 });
    await service.markAllRead('user-1');
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
