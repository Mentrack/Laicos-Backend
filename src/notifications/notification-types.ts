import {
  NotificationChannel,
  NotificationType,
  Prisma,
  Role,
} from '../../generated/client';
import {
  orderReceivedEmail,
  orderReceivedLine,
  RenderedEmail,
} from '../mail/templates';

export interface Recipient {
  id: string;
  email: string;
  firstName: string;
  role: Role;
}

export interface NotificationParams {
  ORDER_RECEIVED: { orderId: string; produceName: string };
}

export interface RenderedNotification {
  title: string;
  body: string;
  data: Prisma.InputJsonObject | null;
  email: RenderedEmail;
}

export interface NotificationTypeDefinition<P> {
  channels: NotificationChannel[];
  render(params: P, recipient: Recipient): RenderedNotification;
}

// Keyed by the enum so a new NotificationType without an entry fails to compile.
export const NOTIFICATION_TYPES: {
  [T in NotificationType]: NotificationTypeDefinition<NotificationParams[T]>;
} = {
  ORDER_RECEIVED: {
    channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL],
    render({ orderId, produceName }, recipient) {
      const forAgent = recipient.role === Role.EXTENSION_AGENT;
      return {
        title: 'New order',
        body: orderReceivedLine(produceName, forAgent),
        data: { resource: 'ORDER', resourceId: orderId },
        email: orderReceivedEmail({
          firstName: recipient.firstName,
          produceName,
          forAgent,
        }),
      };
    },
  },
};
