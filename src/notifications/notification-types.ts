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
  sourcingAssignedEmail,
  sourcingAssignedLine,
  sourcingContractReadyEmail,
  sourcingContractReadyLine,
  sourcingOfferEmail,
  sourcingOfferLine,
  sourcingOfferWithdrawnEmail,
  sourcingOfferWithdrawnLine,
  sourcingPaymentReadyEmail,
  sourcingPaymentReadyLine,
  sourcingUnansweredEmail,
  sourcingUnansweredLine,
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
  SOURCING_ASSIGNED: {
    requestId: string;
    requestNumber: string;
    produceName: string;
  };
  SOURCING_UNANSWERED: {
    requestId: string;
    requestNumber: string;
    responseHours: number;
  };
  SOURCING_OFFER: {
    requestId: string;
    offerId: string;
    produceName: string;
    quantity: string;
    unit: string;
  };
  SOURCING_OFFER_WITHDRAWN: {
    requestId: string;
    offerId: string;
    produceName: string;
  };
  SOURCING_CONTRACT_READY: { requestId: string; requestNumber: string };
  SOURCING_PAYMENT_READY: {
    requestId: string;
    requestNumber: string;
    checkoutId: string;
    amount: string;
  };
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
const EMAIL_ONLY = [NotificationChannel.EMAIL];

function sourcingData(
  requestId: string,
  offerId?: string,
): Prisma.InputJsonObject {
  return {
    resource: 'SOURCING_REQUEST',
    resourceId: requestId,
    requestId,
    ...(offerId ? { offerId } : {}),
  };
}

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
  SOURCING_ASSIGNED: {
    channels: PUSH_AND_EMAIL,
    render({ requestId, requestNumber, produceName }, recipient) {
      return {
        title: 'New sourcing request',
        body: sourcingAssignedLine(requestNumber, produceName),
        data: sourcingData(requestId),
        email: sourcingAssignedEmail({
          firstName: recipient.firstName,
          requestNumber,
          produceName,
        }),
      };
    },
  },
  SOURCING_UNANSWERED: {
    channels: EMAIL_ONLY,
    render({ requestId, requestNumber, responseHours }, recipient) {
      return {
        title: 'Sourcing request update',
        body: sourcingUnansweredLine(requestNumber),
        data: sourcingData(requestId),
        email: sourcingUnansweredEmail({
          firstName: recipient.firstName,
          requestNumber,
          responseHours,
        }),
      };
    },
  },
  SOURCING_OFFER: {
    channels: PUSH_AND_EMAIL,
    render({ requestId, offerId, produceName, quantity, unit }, recipient) {
      return {
        title: 'New supply offer',
        body: sourcingOfferLine(produceName, quantity, unit),
        data: sourcingData(requestId, offerId),
        email: sourcingOfferEmail({
          firstName: recipient.firstName,
          produceName,
          quantity,
          unit,
        }),
      };
    },
  },
  SOURCING_OFFER_WITHDRAWN: {
    channels: PUSH_AND_EMAIL,
    render({ requestId, offerId, produceName }, recipient) {
      return {
        title: 'Offer withdrawn',
        body: sourcingOfferWithdrawnLine(produceName),
        data: sourcingData(requestId, offerId),
        email: sourcingOfferWithdrawnEmail({
          firstName: recipient.firstName,
          produceName,
        }),
      };
    },
  },
  SOURCING_CONTRACT_READY: {
    channels: PUSH_AND_EMAIL,
    render({ requestId, requestNumber }, recipient) {
      return {
        title: 'Contract ready',
        body: sourcingContractReadyLine(requestNumber),
        data: sourcingData(requestId),
        email: sourcingContractReadyEmail({
          firstName: recipient.firstName,
          requestNumber,
        }),
      };
    },
  },
  SOURCING_PAYMENT_READY: {
    channels: PUSH_AND_EMAIL,
    render({ requestId, requestNumber, checkoutId, amount }, recipient) {
      return {
        title: 'Ready for payment',
        body: sourcingPaymentReadyLine(requestNumber, amount),
        data: { ...sourcingData(requestId), checkoutId },
        email: sourcingPaymentReadyEmail({
          firstName: recipient.firstName,
          requestNumber,
          amount,
        }),
      };
    },
  },
};
