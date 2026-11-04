import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/client';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationQueryDto } from './dto/notification-query.dto';
import type { NotificationDto } from './dto/notification.dto';
import type { UnreadCountDto } from './dto/unread-count.dto';
import { formatNotification } from './formatters/notification.formatter';

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: NotificationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      data: rows.map(formatNotification),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    // Only unread rows are touched, so a repeat call keeps the first readAt.
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    return formatNotification(row);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
