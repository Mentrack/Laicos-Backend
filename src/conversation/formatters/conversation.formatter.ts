import type { Message, Prisma } from '../../../generated/client';
import type { ConversationDto, MessageDto } from '../dto';
import { isClosed } from '../utils/conversation-window';

const PARTICIPANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export const CONVERSATION_INCLUDE = {
  order: {
    select: {
      orderNumber: true,
      status: true,
      produceName: true,
      quantity: true,
      type: true,
      produce: { select: { unit: true } },
    },
  },
  buyer: { select: { userId: true, user: { select: PARTICIPANT_SELECT } } },
  agentUser: { select: PARTICIPANT_SELECT },
  messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.ConversationInclude;

export type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

export function formatMessage(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

export function formatConversation(
  row: ConversationRow,
  viewerId: string,
  unreadCount: number,
): ConversationDto {
  const counterpart =
    viewerId === row.agentUserId ? row.buyer.user : row.agentUser;
  const [lastMessage] = row.messages;
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    orderStatus: row.order.status,
    produceName: row.order.produceName,
    quantity: row.order.quantity,
    unit: row.order.produce.unit,
    type: row.order.type,
    isClosed: isClosed(row.order.status),
    counterpart: {
      userId: counterpart.id,
      firstName: counterpart.firstName,
      lastName: counterpart.lastName,
      role: counterpart.role,
    },
    lastMessage: lastMessage ? formatMessage(lastMessage) : null,
    unreadCount,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
  };
}
