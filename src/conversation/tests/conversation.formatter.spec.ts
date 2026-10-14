import { OrderStatus, ProduceType, Role } from '../../../generated/client';
import {
  formatConversation,
  type ConversationRow,
} from '../formatters/conversation.formatter';

const created = new Date('2026-10-13T10:00:00Z');

function row(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'conv-1',
    orderId: 'order-1',
    buyerId: 'buyer-1',
    agentUserId: 'agent-user-1',
    buyerLastReadAt: null,
    agentLastReadAt: null,
    lastMessageAt: null,
    createdAt: created,
    updatedAt: created,
    order: {
      orderNumber: 'ORD-000123',
      status: OrderStatus.PENDING,
      produceName: 'Cassava',
      quantity: 5,
      type: ProduceType.LOCAL,
      produce: { unit: 'tonnes' },
    },
    buyer: {
      userId: 'buyer-user-1',
      user: {
        id: 'buyer-user-1',
        firstName: 'Ada',
        lastName: 'Obi',
        role: Role.BUYER,
      },
    },
    agentUser: {
      id: 'agent-user-1',
      firstName: 'Musa',
      lastName: 'Bello',
      role: Role.EXTENSION_AGENT,
    },
    messages: [],
    ...overrides,
  };
}

describe('formatConversation', () => {
  it('shows the agent to the buyer', () => {
    expect(formatConversation(row(), 'buyer-1', 2)).toMatchObject({
      orderNumber: 'ORD-000123',
      unit: 'tonnes',
      isClosed: false,
      unreadCount: 2,
      lastMessage: null,
      counterpart: { userId: 'agent-user-1', role: Role.EXTENSION_AGENT },
    });
  });

  it('shows the buyer to the agent', () => {
    expect(
      formatConversation(row(), 'agent-user-1', 0).counterpart.userId,
    ).toBe('buyer-user-1');
  });

  it.each([OrderStatus.FULFILLED, OrderStatus.CANCELLED])(
    'marks a %s order closed',
    (status) => {
      const closed = row({ order: { ...row().order, status } });
      expect(formatConversation(closed, 'buyer-1', 0).isClosed).toBe(true);
    },
  );

  it('includes the latest message', () => {
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'buyer-1',
      body: 'Hello',
      clientMessageId: 'client-1',
      createdAt: created,
    };
    expect(
      formatConversation(row({ messages: [message] }), 'buyer-1', 0)
        .lastMessage,
    ).toEqual(message);
  });
});
