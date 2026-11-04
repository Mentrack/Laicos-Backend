import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminNotificationController } from './admin-notification.controller';
import { DeliveryService } from './delivery.service';
import { DeviceService } from './device.service';
import { InboxService } from './inbox.service';
import { NotificationController } from './notification.controller';
import { NOTIFICATIONS_QUEUE, NotificationQueue } from './notification-queue';
import {
  NotificationProcessor,
  NotificationSweepScheduler,
} from './notification.processor';
import { NotificationService } from './notification.service';
import { EmailChannelAdapter } from './channels/email.adapter';
import { ExpoPushAdapter } from './channels/push.adapter';

@Global()
@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: NOTIFICATIONS_QUEUE,
      // registerQueue's defaultJobOptions replace the root ones wholesale, so
      // the removeOn* settings are repeated here.
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [NotificationController, AdminNotificationController],
  providers: [
    InboxService,
    DeviceService,
    NotificationQueue,
    NotificationService,
    ExpoPushAdapter,
    EmailChannelAdapter,
    DeliveryService,
    NotificationProcessor,
    NotificationSweepScheduler,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
