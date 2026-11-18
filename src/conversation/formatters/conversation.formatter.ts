import type { Message, Prisma } from '../../../generated/client';
import type { ConversationDto, MessageDto } from '../dto';
import {
  WINDOW_ORDER_SELECT,
  isClosed,
  sourcingChatClosed,
} from '../utils/conversation-window';
import {
  SOURCING_CHAT_SELECT,
  paidOrders,
} from '../utils/sourcing-conversation';

const PARTICIPANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export const CONVERSATION_INCLUDE = {
  order: {
    select: {
      ...WINDOW_ORDER_SELECT,
      orderNumber: true,
      produceName: true,
      quantity: true,
      type: true,
      produce: { select: { unit: true } },
    },
  },
  sourcingRequest: {
    select: {
      ...SOURCING_CHAT_SELECT,
      produceName: true,
      quantity: true,
      unit: true,
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
  holdHours: number,
): ConversationDto {
  const counterpart =
    viewerId === row.agentUserId ? row.buyer.user : row.agentUser;
  const [lastMessage] = row.messages;
  return {
    id: row.id,
    ...formatSubject(row, holdHours, new Date()),
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

type Subject = Pick<
  ConversationDto,
  | 'orderId'
  | 'sourcingRequestId'
  | 'orderNumber'
  | 'orderStatus'
  | 'produceName'
  | 'quantity'
  | 'unit'
  | 'type'
  | 'isClosed'
>;

function formatSubject(
  row: ConversationRow,
  holdHours: number,
  now: Date,
): Subject {
  const { order, sourcingRequest } = row;
  if (order) {
    return {
      orderId: row.orderId,
      sourcingRequestId: null,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      produceName: order.produceName,
      quantity: order.quantity,
      unit: order.produce.unit,
      type: order.type,
      isClosed: isClosed(order, holdHours, now),
    };
  }
  // A CHECK constraint makes every conversation belong to exactly one of the two.
  if (!sourcingRequest) {
    throw new Error(`Conversation ${row.id} has no order or sourcing request`);
  }
  return {
    orderId: null,
    sourcingRequestId: row.sourcingRequestId,
    orderNumber: null,
    orderStatus: null,
    produceName: sourcingRequest.produceName,
    quantity: sourcingRequest.quantity,
    unit: sourcingRequest.unit,
    type: null,
    isClosed: sourcingChatClosed(
      sourcingRequest,
      paidOrders(sourcingRequest),
      holdHours,
      now,
    ),
  };
}
