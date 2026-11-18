import type { Prisma } from '../../../generated/client';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  OrderStatus,
  SourcingRequestStatus,
} from '../../../generated/client';
import { voidLiveContract } from './sourcing-contract';
import { canMove, moveSourcingStatus } from './sourcing-transitions';

const PAID_ORDERS = {
  where: { status: CheckoutStatus.PAID },
  select: { orders: { select: { status: true } } },
  take: 1,
} satisfies Prisma.SourcingRequest$checkoutsArgs;

const SYSTEM_AUDIT_TITLE: Partial<Record<SourcingRequestStatus, string>> = {
  [SourcingRequestStatus.COMPLETED]: 'Payment received',
  [SourcingRequestStatus.FULFILLED]: 'Request fulfilled',
  [SourcingRequestStatus.CLOSED]: 'Request closed',
};

/**
 * Applies the system transitions that follow from the paid checkout and its
 * orders. Call it in the same transaction as the change. A missing request,
 * or one in any other state, is left alone.
 */
export async function syncSourcingRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  const request = await tx.sourcingRequest.findUnique({
    where: { id: requestId },
    select: { status: true, closeReason: true, checkouts: PAID_ORDERS },
  });
  const paid = request?.checkouts[0];
  if (!request || !paid) {
    return;
  }
  const orders = paid.orders.map((order) => order.status);
  // An empty order list is not "all cancelled".
  const finished =
    orders.length > 0 &&
    orders.every(
      (status) =>
        status === OrderStatus.FULFILLED || status === OrderStatus.CANCELLED,
    );
  let status = request.status;
  const applied: SourcingRequestStatus[] = [];
  const step = (to: SourcingRequestStatus) => {
    if (canMove(status, to, 'SYSTEM')) {
      status = to;
      applied.push(to);
    }
  };
  step(SourcingRequestStatus.COMPLETED);
  if (finished) {
    step(
      orders.includes(OrderStatus.FULFILLED)
        ? SourcingRequestStatus.FULFILLED
        : SourcingRequestStatus.CLOSED,
    );
  }
  if (applied.length === 0) {
    return;
  }
  await tx.sourcingRequest.update({
    where: { id: requestId },
    data: {
      status,
      ...(status === SourcingRequestStatus.CLOSED
        ? {
            closedAt: new Date(),
            closeReason: request.closeReason ?? 'All orders were cancelled',
          }
        : {}),
    },
  });
  for (const to of applied) {
    await recordLinkedAudit(tx, {
      actorType: AuditActorType.SYSTEM,
      actorUserId: null,
      farmerId: null,
      agentId: null,
      farmId: null,
      category: AuditCategory.SOURCING,
      title: SYSTEM_AUDIT_TITLE[to] ?? 'Status updated',
      summary: to,
      actionLabel: 'View request',
      resource: AuditResource.SOURCING_REQUEST,
      resourceId: requestId,
      sourcingRequestId: requestId,
    });
  }
}

/**
 * A sourced checkout's payment hold ran out: void the contract and send the
 * request back to negotiation with its offers kept, so the agent can
 * re-confirm. A request no longer CONFIRMED (e.g. closed meanwhile) is left
 * alone. Writes the one audit row for the transition, attributed to `cause`.
 */
export async function lapseSourcedCheckout(
  tx: Prisma.TransactionClient,
  requestId: string,
  cause: {
    actorType: AuditActorType;
    actorUserId: string | null;
    title: string;
    summary: string;
  },
): Promise<void> {
  const request = await tx.sourcingRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (request?.status !== SourcingRequestStatus.CONFIRMED) {
    return;
  }
  await voidLiveContract(tx, requestId);
  await moveSourcingStatus(
    tx,
    requestId,
    SourcingRequestStatus.NEGOTIATING,
    'SYSTEM',
  );
  await recordLinkedAudit(tx, {
    actorType: cause.actorType,
    actorUserId: cause.actorUserId,
    farmerId: null,
    agentId: null,
    farmId: null,
    category: AuditCategory.SOURCING,
    title: cause.title,
    summary: cause.summary,
    actionLabel: 'View request',
    resource: AuditResource.SOURCING_REQUEST,
    resourceId: requestId,
    sourcingRequestId: requestId,
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
    actorUserId: string | null;
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
    orderId?: string | null;
  },
): Promise<void> {
  await tx.auditEvent.create({ data: event });
}
