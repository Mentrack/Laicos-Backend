import {
  PaymentStatus,
  Prisma,
  VerificationTaskStatus,
} from '../../../generated/client';
import { buyerDisplayName } from '../../buyer/formatters/buyer.formatter';
import { fullName } from '../../common/names';
import { AdminOrderDetailDto } from '../dto';

export const ADMIN_ORDER_DETAIL_INCLUDE = {
  produce: { select: { unit: true } },
  buyer: {
    include: {
      user: { select: { firstName: true, lastName: true, phoneNumber: true } },
    },
  },
  farm: {
    include: {
      lga: { select: { name: true } },
      state: { select: { name: true } },
      cluster: { select: { clusterCode: true } },
      verifications: {
        where: { status: VerificationTaskStatus.APPROVED },
        orderBy: { decidedAt: { sort: 'desc', nulls: 'last' } },
        take: 1,
        select: { decidedAt: true },
      },
    },
  },
  checkout: {
    include: {
      payments: { where: { status: PaymentStatus.SUCCEEDED }, take: 1 },
      sourcingRequest: {
        include: {
          allocations: { select: { produce: { select: { farmId: true } } } },
        },
      },
    },
  },
  dispute: {
    include: { raisedBy: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.OrderInclude;

export type AdminDetailedOrder = Prisma.OrderGetPayload<{
  include: typeof ADMIN_ORDER_DETAIL_INCLUDE;
}>;

function deliveryDestination(checkout: {
  deliveryLabel: string | null;
  deliveryStreet: string | null;
  deliveryLga: string | null;
  deliveryState: string | null;
}): string | null {
  const parts = [
    checkout.deliveryLabel,
    checkout.deliveryStreet,
    checkout.deliveryLga,
    checkout.deliveryState,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function toAdminOrderDetail(
  order: AdminDetailedOrder,
): AdminOrderDetailDto {
  const { buyer, farm, checkout, dispute } = order;
  const request = checkout?.sourcingRequest;
  const succeeded = checkout?.payments[0];
  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: order.status,
      quantity: order.quantity,
      unit: order.produce.unit,
      produceName: order.produceName,
      type: order.type,
      totalPrice: order.totalPrice.toFixed(2),
      agentCommission: order.agentCommission.toFixed(2),
      cancellationReason: order.cancellationReason,
      fulfilledAt: order.fulfilledAt,
    },
    buyer: {
      id: buyer.id,
      buyerId: buyer.buyerId,
      name: buyerDisplayName(buyer),
      buyerType: buyer.buyerType,
      contactPhone: buyer.contactPhone ?? buyer.user.phoneNumber,
      deliveryDestination: checkout ? deliveryDestination(checkout) : null,
    },
    farm: {
      id: farm.id,
      farmCode: farm.farmCode,
      name: farm.name,
      lga: farm.lga.name,
      state: farm.state.name,
      clusterCode: farm.cluster?.clusterCode ?? null,
      verificationStatus: farm.verificationStatus,
      verifiedAt: farm.verifications[0]?.decidedAt ?? null,
    },
    payment: checkout
      ? {
          checkoutNumber: checkout.checkoutNumber,
          checkoutStatus: checkout.status,
          total: checkout.totalPrice.toFixed(2),
          expiresAt: checkout.expiresAt,
          paidAt: checkout.paidAt,
          payment: succeeded
            ? {
                reference: succeeded.reference,
                provider: succeeded.provider,
                channel: succeeded.channel,
                amount: succeeded.amount.toFixed(2),
                currency: succeeded.currency,
              }
            : null,
        }
      : null,
    sourcingRequest:
      checkout && request
        ? {
            id: request.id,
            requestNumber: request.requestNumber,
            produceName: request.produceName,
            quantity: request.quantity,
            unit: request.unit,
            farmsAllocated: new Set(
              request.allocations.map(({ produce }) => produce.farmId),
            ).size,
            confirmedAt: checkout.createdAt,
          }
        : null,
    dispute: dispute
      ? {
          id: dispute.id,
          status: dispute.status,
          reason: dispute.reason,
          quantityAffected: dispute.quantityAffected,
          raisedBy: fullName(dispute.raisedBy),
          createdAt: dispute.createdAt,
          refundPercent: dispute.refundPercent?.toFixed(2) ?? null,
          resolutionNote: dispute.resolutionNote,
          resolvedAt: dispute.resolvedAt,
        }
      : null,
  };
}
