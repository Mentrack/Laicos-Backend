import {
  CheckoutStatus,
  type Conversation,
  type Prisma,
  type SourcingRequest,
} from '../../../generated/client';
import { WINDOW_ORDER_SELECT, type WindowOrder } from './conversation-window';

/** What sourcingChatClosed needs from a request. */
export const SOURCING_CHAT_SELECT = {
  status: true,
  // A request has at most one PAID checkout.
  checkouts: {
    where: { status: CheckoutStatus.PAID },
    select: { orders: { select: WINDOW_ORDER_SELECT } },
    take: 1,
  },
} satisfies Prisma.SourcingRequestSelect;

export function paidOrders(request: {
  checkouts: { orders: WindowOrder[] }[];
}): WindowOrder[] {
  return request.checkouts.flatMap((checkout) => checkout.orders);
}

/**
 * Opens the buyer-agent chat for a request when the agent accepts it.
 * Returns the existing row if there is one.
 */
export function openSourcingConversation(
  tx: Prisma.TransactionClient,
  request: Pick<SourcingRequest, 'id' | 'buyerId'>,
  agentUserId: string,
): Promise<Conversation> {
  return tx.conversation.upsert({
    where: { sourcingRequestId: request.id },
    create: {
      sourcingRequestId: request.id,
      buyerId: request.buyerId,
      agentUserId,
    },
    update: {},
  });
}
