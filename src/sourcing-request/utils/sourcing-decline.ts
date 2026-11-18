import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  NotificationType,
  SourcingRequestStatus,
  type Prisma,
} from '../../../generated/client';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationService } from '../../notifications/notification.service';
import { moveSourcingStatus } from './sourcing-transitions';

export interface DeclinedRequest {
  id: string;
  requestNumber: string;
  assignedAgentId: string | null;
  buyer: { userId: string };
}

/**
 * Returns an assigned request to the pool. The caller holds the request lock
 * and dispatches the returned delivery ids after the transaction commits.
 * A null reason means the response window expired.
 */
export async function returnToPending(
  tx: Prisma.TransactionClient,
  deps: {
    notifications: NotificationService;
    audit: AuditService;
    responseHours: number;
  },
  request: DeclinedRequest,
  reason: string | null,
  // The declining agent's User.id; null when the window expired.
  actorUserId: string | null,
): Promise<string[]> {
  await moveSourcingStatus(
    tx,
    request.id,
    SourcingRequestStatus.PENDING,
    actorUserId ? 'AGENT' : 'SYSTEM',
  );
  if (request.assignedAgentId) {
    await tx.sourcingDecline.create({
      data: {
        sourcingRequestId: request.id,
        agentId: request.assignedAgentId,
        reason,
      },
    });
  }
  await tx.sourcingRequest.update({
    where: { id: request.id },
    data: { assignedAgentId: null, assignedAt: null },
  });
  await deps.audit.record(tx, {
    actorType: actorUserId
      ? AuditActorType.EXTENSION_AGENT
      : AuditActorType.SYSTEM,
    actorUserId,
    farmerId: null,
    // AuditEvent_actor_check: a SYSTEM row must not name an agent. The agent
    // stays on the SourcingDecline row.
    agentId: actorUserId ? request.assignedAgentId : null,
    farmId: null,
    category: AuditCategory.SOURCING,
    title: actorUserId ? 'Request declined' : 'Request returned to the pool',
    summary: reason ?? 'Response window expired',
    actionLabel: 'View request',
    resource: AuditResource.SOURCING_REQUEST,
    resourceId: request.id,
    sourcingRequestId: request.id,
  });
  return deps.notifications.notify(
    {
      userIds: [request.buyer.userId],
      type: NotificationType.SOURCING_UNANSWERED,
      params: {
        requestId: request.id,
        requestNumber: request.requestNumber,
        responseHours: deps.responseHours,
      },
    },
    tx,
  );
}
