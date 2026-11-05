import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import {
  DeliveryStatus,
  NotificationChannel,
  type Prisma,
} from '../../generated/client';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { PermanentSendError } from '../common/permanent-send-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChannelAdapter,
  ChannelOutcome,
  DeliveryTarget,
} from './channels/channel-adapter';
import { EmailChannelAdapter } from './channels/email.adapter';
import { ExpoPushAdapter } from './channels/push.adapter';
import { DeliveryQueryDto } from './dto/delivery-query.dto';
import { DeliveryDto } from './dto/delivery.dto';
import {
  deliveryInclude,
  formatDelivery,
} from './formatters/delivery.formatter';
import { NotificationQueue } from './notification-queue';

const SWEEP_AFTER_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 500;

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly adapters: Record<NotificationChannel, ChannelAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    push: ExpoPushAdapter,
    email: EmailChannelAdapter,
    private readonly queue: NotificationQueue,
  ) {
    this.adapters = {
      [NotificationChannel.PUSH]: push,
      [NotificationChannel.EMAIL]: email,
    };
  }

  async deliver(deliveryId: string, finalAttempt: boolean): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: { user: { select: { email: true } } },
        },
      },
    });
    if (!delivery || delivery.status !== DeliveryStatus.PENDING) return;

    const { notification } = delivery;
    const target: DeliveryTarget = {
      userId: notification.userId,
      email: notification.user.email,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      emailSubject: delivery.emailSubject,
      emailHtml: delivery.emailHtml,
      emailText: delivery.emailText,
    };

    let outcome: ChannelOutcome;
    try {
      outcome = await this.adapters[delivery.channel].send(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PermanentSendError) {
        await this.settle(deliveryId, {
          status: DeliveryStatus.FAILED,
          lastError: message,
        });
        throw new UnrecoverableError(message);
      }
      await this.settle(deliveryId, {
        ...(finalAttempt ? { status: DeliveryStatus.FAILED } : {}),
        lastError: message,
      });
      throw error;
    }
    // Outside the try: a DB failure here must not mark a delivered message FAILED.
    await this.settle(deliveryId, {
      status: outcome,
      ...(outcome === 'SENT' ? { sentAt: new Date() } : {}),
      lastError: null,
    });
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.notificationDelivery.findMany({
      where: {
        status: DeliveryStatus.PENDING,
        createdAt: { lt: new Date(now.getTime() - SWEEP_AFTER_MS) },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: SWEEP_BATCH,
    });
    if (stale.length) {
      await this.queue.enqueue(stale.map((d) => d.id));
    }
    return stale.length;
  }

  async list(query: DeliveryQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.NotificationDeliveryWhereInput = {
      status: query.status ?? DeliveryStatus.FAILED,
    };
    const [rows, total] = await Promise.all([
      this.prisma.notificationDelivery.findMany({
        where,
        include: deliveryInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);
    return {
      data: rows.map(formatDelivery),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async retry(id: string): Promise<DeliveryDto> {
    const existing = await this.prisma.notificationDelivery.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException('Delivery not found');
    if (existing.status !== DeliveryStatus.FAILED) {
      throw new ConflictException('Only failed deliveries can be retried');
    }
    // Guarded on FAILED so two admins cannot both re-queue the same row.
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { id, status: DeliveryStatus.FAILED },
      data: { status: DeliveryStatus.PENDING, attempts: 0, lastError: null },
    });
    if (count === 0) {
      throw new ConflictException('Delivery is no longer failed');
    }
    // The row is already PENDING, so a failed enqueue is recovered by the sweep;
    // failing the request would make the next click a 409.
    try {
      await this.queue.enqueue([id]);
    } catch (err) {
      this.logger.error(
        `Could not enqueue retry for delivery ${id}; the sweep will retry`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    const updated = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id },
      include: deliveryInclude,
    });
    return formatDelivery(updated);
  }

  // Guarded on PENDING so a concurrent admin action is never overwritten.
  private async settle(
    id: string,
    data: {
      status?: DeliveryStatus;
      sentAt?: Date;
      lastError: string | null;
    },
  ): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: DeliveryStatus.PENDING },
      data: { ...data, attempts: { increment: 1 } },
    });
  }
}
