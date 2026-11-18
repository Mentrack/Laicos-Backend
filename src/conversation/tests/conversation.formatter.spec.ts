import {
  OrderStatus,
  ProduceType,
  Role,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';
import {
  formatConversation,
  type ConversationRow,
} from '../formatters/conversation.formatter';

const created = new Date('2026-10-13T10:00:00Z');
const order = {
  orderNumber: 'ORD-000123',
  status: OrderStatus.PENDING,
  fulfilledAt: null,
  dispute: null,
  produceName: 'Cassava',
  quantity: 5,
  type: ProduceType.LOCAL,
  produce: { unit: 'tonnes' },
};

function row(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'conv-1',
    orderId: 'order-1',
    sourcingRequestId: null,
    buyerId: 'buyer-1',
    agentUserId: 'agent-user-1',
    buyerLastReadAt: null,
    agentLastReadAt: null,
    lastMessageAt: null,
    createdAt: created,
    updatedAt: created,
    order,
    sourcingRequest: null,
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
    expect(formatConversation(row(), 'buyer-1', 2, 24)).toMatchObject({
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
      formatConversation(row(), 'agent-user-1', 0, 24).counterpart.userId,
    ).toBe('buyer-user-1');
  });

  it.each([OrderStatus.FULFILLED, OrderStatus.CANCELLED])(
    'marks a %s order closed',
    (status) => {
      const closed = row({
        order: { ...order, status, fulfilledAt: new Date('2020-01-01') },
      });
      expect(formatConversation(closed, 'buyer-1', 0, 24).isClosed).toBe(true);
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
      formatConversation(row({ messages: [message] }), 'buyer-1', 0, 24)
        .lastMessage,
    ).toEqual(message);
  });

  it('describes a sourcing chat from its request', () => {
    const sourcing = row({
      orderId: null,
      order: null,
      sourcingRequestId: 'req-1',
      sourcingRequest: {
        status: SourcingRequestStatus.NEGOTIATING,
        produceName: 'Maize',
        quantity: 12,
        unit: SourcingUnit.TONNES,
        checkouts: [],
      },
    });
    expect(formatConversation(sourcing, 'buyer-1', 0, 24)).toMatchObject({
      orderId: null,
      sourcingRequestId: 'req-1',
      orderNumber: null,
      orderStatus: null,
      type: null,
      produceName: 'Maize',
      quantity: 12,
      unit: SourcingUnit.TONNES,
      isClosed: false,
    });
  });

  it('marks a sourcing chat closed when the request closed before payment', () => {
    const sourcing = row({
      orderId: null,
      order: null,
      sourcingRequestId: 'req-1',
      sourcingRequest: {
        status: SourcingRequestStatus.CLOSED,
        produceName: 'Maize',
        quantity: 12,
        unit: SourcingUnit.TONNES,
        checkouts: [],
      },
    });
    expect(formatConversation(sourcing, 'buyer-1', 0, 24).isClosed).toBe(true);
  });
});
