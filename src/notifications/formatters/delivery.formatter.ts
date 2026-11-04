import type { Prisma } from '../../../generated/client';
import type { DeliveryDto } from '../dto/delivery.dto';

export const deliveryInclude = {
  notification: {
    select: {
      type: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
  },
} satisfies Prisma.NotificationDeliveryInclude;

export type DeliveryRow = Prisma.NotificationDeliveryGetPayload<{
  include: typeof deliveryInclude;
}>;

export function formatDelivery(row: DeliveryRow): DeliveryDto {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    type: row.notification.type,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row.notification.user,
  };
}
