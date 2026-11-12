import { Prisma } from '../../../generated/client';
import { buyerDisplayName } from '../../buyer/formatters/buyer.formatter';
import { AdminOrderRowDto } from '../dto';

export const ADMIN_ORDER_INCLUDE = {
  produce: { select: { id: true, unit: true } },
  buyer: { include: { user: { select: { firstName: true, lastName: true } } } },
  farm: {
    select: {
      id: true,
      farmCode: true,
      name: true,
      cluster: { select: { clusterCode: true } },
    },
  },
  checkout: {
    select: { sourcingRequest: { select: { id: true, requestNumber: true } } },
  },
  dispute: { select: { id: true, status: true } },
} satisfies Prisma.OrderInclude;

export type AdminListedOrder = Prisma.OrderGetPayload<{
  include: typeof ADMIN_ORDER_INCLUDE;
}>;

export function toAdminOrderRow(order: AdminListedOrder): AdminOrderRowDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    quantity: order.quantity,
    unit: order.produce.unit,
    produce: {
      id: order.produce.id,
      name: order.produceName,
      type: order.type,
    },
    buyer: {
      id: order.buyer.id,
      buyerId: order.buyer.buyerId,
      name: buyerDisplayName(order.buyer),
    },
    farm: {
      id: order.farm.id,
      farmCode: order.farm.farmCode,
      name: order.farm.name,
      clusterCode: order.farm.cluster?.clusterCode ?? null,
    },
    sourcingRequest: order.checkout?.sourcingRequest ?? null,
    totalPrice: order.totalPrice.toFixed(2),
    dispute: order.dispute,
  };
}
