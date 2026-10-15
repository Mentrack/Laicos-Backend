import type { Prisma } from '../../../generated/client';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  OrderStatus,
  SourcingRequestStatus,
} from '../../../generated/client';
import { deriveSourcingStatus } from './sourcing-rules';

const LIVE = [CheckoutStatus.AWAITING_PAYMENT, CheckoutStatus.PAID];

/**
 * Rewrites the stored status from the request's rows. Call it in the same
 * transaction as the change. A missing request is left alone.
 */
export async function syncSourcingRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  const request = await tx.sourcingRequest.findUnique({
    where: { id: requestId },
    select: {
      closedAt: true,
      closeReason: true,
      assignedAgentId: true,
      _count: { select: { allocations: true } },
      checkouts: {
        where: { status: { in: LIVE } },
        select: {
          status: true,
          orders: { select: { status: true } },
        },
      },
    },
  });
  if (!request) {
    return;
  }
  const paid = request.checkouts.find(
    (checkout) => checkout.status === CheckoutStatus.PAID,
  );
  const status = deriveSourcingStatus({
    closedAt: request.closedAt,
    assignedAgentId: request.assignedAgentId,
    allocationCount: request._count.allocations,
    awaitingPayment: request.checkouts.some(
      (checkout) => checkout.status === CheckoutStatus.AWAITING_PAYMENT,
    ),
    paidOrders: paid ? paid.orders.map((order) => order.status) : null,
  });
  const autoClose =
    status === SourcingRequestStatus.CLOSED &&
    request.closedAt === null &&
    paid !== undefined &&
    paid.orders.length > 0 &&
    paid.orders.every((order) => order.status === OrderStatus.CANCELLED);
  await tx.sourcingRequest.update({
    where: { id: requestId },
    data: {
      status,
      ...(autoClose
        ? {
            closedAt: new Date(),
            closeReason: request.closeReason ?? 'All orders were cancelled',
          }
        : {}),
    },
  });
}

export async function sourcingRequestIdForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { checkout: { select: { sourcingRequestId: true } } },
  });
  return order?.checkout?.sourcingRequestId ?? null;
}

export async function recordLinkedAudit(
  tx: Prisma.TransactionClient,
  event: {
    actorType: AuditActorType;
    farmerId: string | null;
    agentId: string | null;
    farmId: string | null;
    category: AuditCategory;
    title: string;
    summary: string;
    actionLabel: string | null;
    resource: AuditResource | null;
    resourceId: string | null;
    sourcingRequestId: string;
  },
): Promise<void> {
  await tx.auditEvent.create({ data: event });
}
