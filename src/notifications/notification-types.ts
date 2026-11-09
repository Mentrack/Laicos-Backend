import {
  Currency,
  NotificationChannel,
  NotificationType,
  Prisma,
  Role,
} from '../../generated/client';
import {
  disputeRaisedEmail,
  disputeRaisedLine,
  disputeResolvedEmail,
  disputeResolvedLine,
  orderReceivedEmail,
  orderReceivedLine,
  orderShippedEmail,
  orderShippedLine,
  payoutPaidEmail,
  payoutPaidLine,
  refundProcessedEmail,
  refundProcessedLine,
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
  ORDER_SHIPPED: { orderId: string; orderNumber: string; produceName: string };
  DISPUTE_RAISED: {
    disputeId: string;
    orderId: string;
    orderNumber: string;
    reason: string;
  };
  DISPUTE_RESOLVED: {
    disputeId: string;
    orderId: string;
    orderNumber: string;
    refundPercent: string;
  };
  REFUND_PROCESSED: { refundId: string; amount: string; currency: Currency };
  PAYOUT_PAID: { payoutId: string; reference: string; amount: string };
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

const PUSH_AND_EMAIL = [NotificationChannel.PUSH, NotificationChannel.EMAIL];

// Keyed by NotificationType so a new enum value without a renderer fails to compile.
export const NOTIFICATION_TYPES: {
  [T in NotificationType]: NotificationTypeDefinition<NotificationParams[T]>;
} = {
  ORDER_RECEIVED: {
    channels: PUSH_AND_EMAIL,
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
  ORDER_SHIPPED: {
    channels: PUSH_AND_EMAIL,
    render({ orderId, orderNumber, produceName }, recipient) {
      return {
        title: 'Order shipped',
        body: orderShippedLine(produceName, orderNumber),
        data: { resource: 'ORDER', resourceId: orderId },
        email: orderShippedEmail({
          firstName: recipient.firstName,
          orderNumber,
          produceName,
        }),
      };
    },
  },
  DISPUTE_RAISED: {
    channels: PUSH_AND_EMAIL,
    render({ disputeId, orderNumber, reason }, recipient) {
      return {
        title: 'Dispute raised',
        body: disputeRaisedLine(orderNumber),
        data: { resource: 'DISPUTE', resourceId: disputeId },
        email: disputeRaisedEmail({
          firstName: recipient.firstName,
          orderNumber,
          reason,
        }),
      };
    },
  },
  DISPUTE_RESOLVED: {
    channels: PUSH_AND_EMAIL,
    render({ disputeId, orderNumber, refundPercent }, recipient) {
      return {
        title: 'Dispute resolved',
        body: disputeResolvedLine(orderNumber, refundPercent),
        data: { resource: 'DISPUTE', resourceId: disputeId },
        email: disputeResolvedEmail({
          firstName: recipient.firstName,
          orderNumber,
          refundPercent,
        }),
      };
    },
  },
  REFUND_PROCESSED: {
    channels: PUSH_AND_EMAIL,
    render({ refundId, amount, currency }, recipient) {
      return {
        title: 'Refund processed',
        body: refundProcessedLine(amount, currency),
        data: { resource: 'REFUND', resourceId: refundId },
        email: refundProcessedEmail({
          firstName: recipient.firstName,
          amount,
          currency,
        }),
      };
    },
  },
  PAYOUT_PAID: {
    channels: PUSH_AND_EMAIL,
    render({ payoutId, reference, amount }, recipient) {
      return {
        title: 'Payout paid',
        body: payoutPaidLine(reference, amount),
        data: { resource: 'PAYOUT', resourceId: payoutId },
        email: payoutPaidEmail({
          firstName: recipient.firstName,
          reference,
          amount,
        }),
      };
    },
  },
};
