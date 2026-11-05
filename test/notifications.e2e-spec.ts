import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  DeliveryStatus,
  NotificationChannel,
  NotificationType,
  PushPlatform,
  Role,
  type User,
} from '../generated/client';
import { DeviceService } from '../src/notifications/device.service';
import { InboxService } from '../src/notifications/inbox.service';
import type { NotificationQueue } from '../src/notifications/notification-queue';
import { NotificationService } from '../src/notifications/notification.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses any
// non-local DATABASE_URL. Rows are tagged with this run's id and removed in
// afterAll.
const run = randomUUID().slice(0, 8);

describe('Notifications (real Postgres)', () => {
  const db = new PrismaService(new ConfigService());
  const queue = { enqueue: jest.fn() } as unknown as NotificationQueue;
  const notifications = new NotificationService(db, queue);
  const inbox = new InboxService(db);
  const devices = new DeviceService(db);
  const users: User[] = [];

  async function user() {
    const tag = `${run}-${randomUUID()}`;
    const created = await db.user.create({
      data: {
        firebaseUid: `e2e-${tag}`,
        email: `e2e-${tag}@example.com`,
        firstName: 'E2E',
        lastName: 'Notify',
        role: Role.BUYER,
        isVerified: true,
      },
    });
    users.push(created);
    return created;
  }

  const order = { orderId: randomUUID(), produceName: 'Maize' };

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  });

  it('writes a notification and its deliveries per recipient, all PENDING', async () => {
    const [a, b] = [await user(), await user()];
    const ids = await notifications.notify({
      userIds: [a.id, b.id],
      type: NotificationType.ORDER_RECEIVED,
      params: order,
    });
    expect(ids).toHaveLength(4);

    const rows = await db.notification.findMany({
      where: { userId: { in: [a.id, b.id] } },
      include: { deliveries: true },
    });
    expect(rows).toHaveLength(2);
    const deliveries = rows.flatMap((r) => r.deliveries);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d) => d.status === DeliveryStatus.PENDING)).toBe(
      true,
    );
  });

  it('tracks unread counts and keeps inboxes private', async () => {
    const [a, b] = [await user(), await user()];
    for (let i = 0; i < 2; i++) {
      await notifications.notify({
        userIds: [a.id],
        type: NotificationType.ORDER_RECEIVED,
        params: order,
      });
    }
    const [first] = (await inbox.list(a.id, {})).data;
    expect(await inbox.unreadCount(a.id)).toEqual({ count: 2 });

    await expect(inbox.markRead(b.id, first.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await inbox.unreadCount(a.id)).toEqual({ count: 2 });

    const read = await inbox.markRead(a.id, first.id);
    expect(read.readAt).toBeInstanceOf(Date);
    const again = await inbox.markRead(a.id, first.id);
    expect(again.readAt).toEqual(read.readAt);
    expect(await inbox.unreadCount(a.id)).toEqual({ count: 1 });
    expect((await inbox.list(a.id, { unread: true })).data).toHaveLength(1);

    await inbox.markAllRead(a.id);
    expect(await inbox.unreadCount(a.id)).toEqual({ count: 0 });
  });

  it('rejects email deliveries that break the content CHECK', async () => {
    const owner = await user();
    const notification = await db.notification.create({
      data: {
        userId: owner.id,
        type: NotificationType.ORDER_RECEIVED,
        title: 'T',
        body: 'B',
      },
    });
    await expect(
      db.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.EMAIL,
          emailSubject: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.PUSH,
          emailSubject: 'Subject',
        },
      }),
    ).rejects.toThrow();
  });

  it('moves a device to its latest registrant', async () => {
    const [a, b] = [await user(), await user()];
    const token = `ExponentPushToken[${run}-${randomUUID()}]`;
    await devices.register(a.id, { token, platform: PushPlatform.IOS });
    await devices.register(b.id, { token, platform: PushPlatform.ANDROID });
    const row = await db.pushDevice.findUniqueOrThrow({ where: { token } });
    expect(row).toMatchObject({ userId: b.id, platform: PushPlatform.ANDROID });

    await devices.unregister(a.id, token);
    expect(await db.pushDevice.count({ where: { token } })).toBe(1);
    await devices.unregister(b.id, token);
    expect(await db.pushDevice.count({ where: { token } })).toBe(0);
  });

  it('cascades a deleted user to notifications, deliveries and devices', async () => {
    const doomed = await user();
    await notifications.notify({
      userIds: [doomed.id],
      type: NotificationType.ORDER_RECEIVED,
      params: order,
    });
    await devices.register(doomed.id, {
      token: `ExpoPushToken[${run}-${randomUUID()}]`,
      platform: PushPlatform.IOS,
    });
    const notificationIds = (
      await db.notification.findMany({ where: { userId: doomed.id } })
    ).map((n) => n.id);

    await db.user.delete({ where: { id: doomed.id } });

    expect(await db.notification.count({ where: { userId: doomed.id } })).toBe(
      0,
    );
    expect(
      await db.notificationDelivery.count({
        where: { notificationId: { in: notificationIds } },
      }),
    ).toBe(0);
    expect(await db.pushDevice.count({ where: { userId: doomed.id } })).toBe(0);
  });
});
