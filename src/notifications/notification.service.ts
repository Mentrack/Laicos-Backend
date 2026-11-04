import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationType,
  Prisma,
} from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueue } from './notification-queue';
import {
  NOTIFICATION_TYPES,
  NotificationParams,
  NotificationTypeDefinition,
  Recipient,
} from './notification-types';

export interface NotifyInput<T extends NotificationType> {
  userIds: string[];
  type: T;
  params: NotificationParams[T];
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueue,
  ) {}

  /**
   * With `tx` it only writes; the caller must `void this.dispatch(ids)` after
   * its transaction commits (not awaited, for the reason below).
   */
  async notify<T extends NotificationType>(
    input: NotifyInput<T>,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    if (tx) return this.write(tx, input);
    const ids = await this.prisma.$transaction((client) =>
      this.write(client, input),
    );
    // Not awaited: with Redis down the queue add can stall for minutes while
    // ioredis buffers commands, and the rows are already safe for the sweep.
    void this.dispatch(ids);
    return ids;
  }

  /** Never throws: unsent rows stay PENDING and the sweep re-enqueues them. */
  async dispatch(deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    try {
      await this.queue.enqueue(deliveryIds);
    } catch (err) {
      this.logger.error(
        `Could not enqueue ${deliveryIds.length} delivery job(s); the sweep will retry`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async write<T extends NotificationType>(
    client: Prisma.TransactionClient,
    { userIds, type, params }: NotifyInput<T>,
  ): Promise<string[]> {
    const wanted = [...new Set(userIds)];
    if (wanted.length === 0) return [];

    const recipients: Recipient[] = await client.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, email: true, firstName: true, role: true },
    });
    const found = new Set(recipients.map((r) => r.id));
    const missing = wanted.filter((id) => !found.has(id));
    if (missing.length > 0) {
      this.logger.warn(
        `Skipping unknown notification recipient(s): ${missing.join(', ')}`,
      );
    }

    const definition: NotificationTypeDefinition<NotificationParams[T]> =
      NOTIFICATION_TYPES[type];
    const ids: string[] = [];
    for (const recipient of recipients) {
      const rendered = definition.render(params, recipient);
      const created = await client.notification.create({
        data: {
          userId: recipient.id,
          type,
          title: rendered.title,
          body: rendered.body,
          // Prisma rejects a plain null for a Json column.
          data: rendered.data ?? Prisma.DbNull,
          deliveries: {
            create: definition.channels.map((channel) =>
              channel === NotificationChannel.EMAIL
                ? {
                    channel,
                    emailSubject: rendered.email.subject,
                    emailHtml: rendered.email.html,
                    emailText: rendered.email.text,
                  }
                : { channel },
            ),
          },
        },
        include: { deliveries: { select: { id: true } } },
      });
      ids.push(...created.deliveries.map((d) => d.id));
    }
    return ids;
  }
}
