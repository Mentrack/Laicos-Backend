import {
  AuditCategory,
  AuditResource,
  type Order,
} from '../../../generated/client';
import type { AuditActor, AuditWrite } from '../../audit/audit.service';

export function orderAuditEvent(
  order: Pick<Order, 'id' | 'orderNumber' | 'farmId'>,
  actor: AuditActor,
  verb: string,
  summary: string,
  links: { farmerId?: string | null; sourcingRequestId?: string | null } = {},
): AuditWrite {
  return {
    actorType: actor.type,
    actorUserId: actor.userId,
    farmerId: links.farmerId ?? null,
    agentId: null,
    farmId: order.farmId,
    category: AuditCategory.ORDER,
    title: `Order ${order.orderNumber} ${verb}`,
    summary,
    actionLabel: 'View order',
    resource: AuditResource.ORDER,
    resourceId: order.id,
    sourcingRequestId: links.sourcingRequestId ?? null,
    orderId: order.id,
  };
}
