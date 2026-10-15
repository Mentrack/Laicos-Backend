import { HttpException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  OrderStatus,
  Prisma,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { buyerProfile } from '../../buyer/tests/buyer.fixture';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ChatGateway } from '../chat.gateway';
import { ConversationService } from '../conversation.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const agent = { id: 'agent-user-1', role: Role.EXTENSION_AGENT } as User;
const otherAgent = { id: 'agent-user-2', role: Role.EXTENSION_AGENT } as User;
const created = new Date('2026-10-13T10:00:00Z');

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    buyerId: buyer.id,
    status: OrderStatus.PENDING,
    handover: null,
    farm: { cluster: { agent: { userId: agent.id } } },
    ...overrides,
  };
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    orderId: 'order-1',
    buyerId: buyer.id,
    agentUserId: agent.id,
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
      userId: buyer.id,
      user: {
        id: buyer.id,
        firstName: 'Ada',
        lastName: 'Obi',
        role: Role.BUYER,
      },
    },
    agentUser: {
      id: agent.id,
      firstName: 'Musa',
      lastName: 'Bello',
      role: Role.EXTENSION_AGENT,
    },
    messages: [],
    ...overrides,
  };
}

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    body: (error as HttpException).getResponse(),
  };
}

describe('ConversationService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    message: { create: jest.fn() },
    conversation: { update: jest.fn() },
    agent: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
  };
  const buyerModel = { findUnique: jest.fn() };
  const database = {
    buyer: buyerModel,
    order: { findUnique: jest.fn() },
    conversation: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    // A plain function so resetAllMocks keeps it: array form for batched
    // reads, callback form for interactive transactions.
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const chat = { emitToUsers: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new ConversationService(
    database as unknown as PrismaService,
    chat as unknown as ChatGateway,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    buyerModel.findUnique.mockImplementation(
      ({ where }: { where: { userId?: string } }) =>
        Promise.resolve(where.userId ? buyerProfile(where.userId) : null),
    );
    database.conversation.findUnique.mockResolvedValue(null);
    database.order.findUnique.mockResolvedValue(orderRow());
    database.conversation.create.mockResolvedValue(conversationRow());
    database.message.count.mockResolvedValue(0);
  });

  describe('open', () => {
    it('opens a thread with the cluster agent for the buyer', async () => {
      const result = await service.open(buyer, 'order-1');
      expect(database.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            orderId: 'order-1',
            buyerId: buyer.id,
            agentUserId: agent.id,
          },
        }),
      );
      expect(result.counterpart.userId).toBe(agent.id);
    });

    it('prefers the handover agent over the cluster agent', async () => {
      database.order.findUnique.mockResolvedValue(
        orderRow({ handover: { agent: { userId: otherAgent.id } } }),
      );
      await service.open(otherAgent, 'order-1');
      expect(database.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentUserId: otherAgent.id,
          }) as unknown,
        }),
      );
    });

    it('lets the agent open it too', async () => {
      await service.open(agent, 'order-1');
      expect(database.conversation.create).toHaveBeenCalled();
    });

    it('returns the existing thread without re-resolving the agent', async () => {
      database.conversation.findUnique.mockResolvedValue(conversationRow());
      await service.open(buyer, 'order-1');
      expect(database.order.findUnique).not.toHaveBeenCalled();
      expect(database.conversation.create).not.toHaveBeenCalled();
    });

    it('keeps the original agent after the farm changes cluster', async () => {
      database.conversation.findUnique.mockResolvedValue(conversationRow());
      await expect(service.open(agent, 'order-1')).resolves.toBeDefined();
      await expect(
        errorBody(service.open(otherAgent, 'order-1')),
      ).resolves.toMatchObject({
        status: 403,
        body: { code: 'NOT_A_PARTICIPANT' },
      });
    });

    it('404s an unknown order', async () => {
      database.order.findUnique.mockResolvedValue(null);
      await expect(
        errorBody(service.open(buyer, 'order-1')),
      ).resolves.toMatchObject({
        status: 404,
      });
    });

    it("403s someone who isn't the buyer or the agent", async () => {
      await expect(
        errorBody(
          service.open({ id: 'stranger', role: Role.BUYER } as User, 'order-1'),
        ),
      ).resolves.toMatchObject({
        status: 403,
        body: { code: 'NOT_A_PARTICIPANT' },
      });
    });

    it('checks participation before revealing that an order is unpaid', async () => {
      database.order.findUnique.mockResolvedValue(
        orderRow({ status: OrderStatus.AWAITING_PAYMENT }),
      );
      await expect(
        errorBody(
          service.open({ id: 'stranger', role: Role.BUYER } as User, 'order-1'),
        ),
      ).resolves.toMatchObject({ status: 403 });
    });

    it('refuses an unpaid order', async () => {
      database.order.findUnique.mockResolvedValue(
        orderRow({ status: OrderStatus.AWAITING_PAYMENT }),
      );
      await expect(
        errorBody(service.open(buyer, 'order-1')),
      ).resolves.toMatchObject({
        status: 409,
        body: {
          code: 'CONVERSATION_NOT_OPEN',
          message: 'Messaging opens once the order is paid',
        },
      });
    });

    it('refuses when no agent holds the farm', async () => {
      database.order.findUnique.mockResolvedValue(
        orderRow({ farm: { cluster: null } }),
      );
      await expect(
        errorBody(service.open(buyer, 'order-1')),
      ).resolves.toMatchObject({
        status: 409,
        body: {
          code: 'NO_AGENT_ASSIGNED',
          message: 'No agent is assigned to this order yet',
        },
      });
    });

    it.each([OrderStatus.FULFILLED, OrderStatus.CANCELLED])(
      'refuses to start a thread on a %s order',
      async (status) => {
        database.order.findUnique.mockResolvedValue(orderRow({ status }));
        await expect(
          errorBody(service.open(buyer, 'order-1')),
        ).resolves.toMatchObject({
          status: 409,
          body: { code: 'CONVERSATION_CLOSED' },
        });
      },
    );

    it('returns the winner when both sides open at once', async () => {
      database.conversation.create.mockRejectedValue(uniqueViolation());
      database.conversation.findUniqueOrThrow.mockResolvedValue(
        conversationRow(),
      );
      await expect(service.open(buyer, 'order-1')).resolves.toMatchObject({
        id: 'conv-1',
      });
    });
  });

  describe('findOne', () => {
    it("counts only the other side's messages after my last read", async () => {
      const lastRead = new Date('2026-10-13T11:00:00Z');
      database.conversation.findUnique.mockResolvedValue(
        conversationRow({ buyerLastReadAt: lastRead }),
      );
      database.message.count.mockResolvedValue(3);
      await expect(service.findOne(buyer, 'conv-1')).resolves.toMatchObject({
        unreadCount: 3,
      });
      expect(database.message.count).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          senderId: { not: buyer.id },
          createdAt: { gt: lastRead },
        },
      });
    });

    it('404s an unknown conversation', async () => {
      await expect(
        errorBody(service.findOne(buyer, 'conv-1')),
      ).resolves.toMatchObject({
        status: 404,
        body: { code: 'CONVERSATION_NOT_FOUND' },
      });
    });

    it("403s a conversation I'm not in", async () => {
      database.conversation.findUnique.mockResolvedValue(conversationRow());
      await expect(
        errorBody(service.findOne(otherAgent, 'conv-1')),
      ).resolves.toMatchObject({
        status: 403,
      });
    });
  });

  describe('findAll', () => {
    it('lists my threads, active ones first, with pagination', async () => {
      database.conversation.findMany.mockResolvedValue([conversationRow()]);
      database.conversation.count.mockResolvedValue(1);
      const result = await service.findAll(agent, { page: 1, perPage: 20 });
      expect(database.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ agentUserId: agent.id }] },
          orderBy: [
            { lastMessageAt: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
          ],
          skip: 0,
          take: 20,
        }),
      );
      expect(result.metaData).toEqual({
        page: 1,
        perPage: 20,
        total: 1,
        totalPages: 1,
      });
      expect(result.data[0].counterpart.userId).toBe(buyer.id);
    });

    it('returns an empty page when I have no threads', async () => {
      database.conversation.findMany.mockResolvedValue([]);
      database.conversation.count.mockResolvedValue(0);
      await expect(
        service.findAll(buyer, { page: 1, perPage: 20 }),
      ).resolves.toEqual({
        data: [],
        metaData: { page: 1, perPage: 20, total: 0, totalPages: 0 },
      });
    });
  });

  const conversation = {
    id: 'conv-1',
    orderId: 'order-1',
    buyerId: buyer.id,
    agentUserId: agent.id,
    buyerLastReadAt: null,
    agentLastReadAt: null,
    buyer: { userId: buyer.id },
  };
  const message = {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: buyer.id,
    body: 'Hello',
    clientMessageId: 'client-1',
    createdAt: created,
  };
  const send = { body: 'Hello', clientMessageId: 'client-1' };

  describe('listMessages', () => {
    beforeEach(() => {
      database.conversation.findUnique.mockResolvedValue(conversation);
      database.message.findMany.mockResolvedValue([message]);
      database.message.findFirst.mockResolvedValue({ id: 'cursor' });
    });

    it('returns the latest page, oldest first', async () => {
      await service.listMessages(buyer, 'conv-1', { limit: 30 });
      expect(database.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: -30,
      });
    });

    it('reads backwards from a before cursor', async () => {
      await service.listMessages(buyer, 'conv-1', {
        before: 'cursor',
        limit: 10,
      });
      expect(database.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor' },
          skip: 1,
          take: -10,
        }),
      );
    });

    it('reads forwards from an after cursor', async () => {
      await service.listMessages(buyer, 'conv-1', {
        after: 'cursor',
        limit: 10,
      });
      expect(database.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor' },
          skip: 1,
          take: 10,
        }),
      );
    });

    it('refuses before and after together', async () => {
      await expect(
        errorBody(
          service.listMessages(buyer, 'conv-1', { before: 'a', after: 'b' }),
        ),
      ).resolves.toMatchObject({
        status: 400,
        body: { code: 'INVALID_CURSOR' },
      });
    });

    it('refuses a cursor from another conversation', async () => {
      database.message.findFirst.mockResolvedValue(null);
      await expect(
        errorBody(
          service.listMessages(buyer, 'conv-1', { before: 'elsewhere' }),
        ),
      ).resolves.toMatchObject({
        status: 400,
        body: { code: 'INVALID_CURSOR' },
      });
      expect(database.message.findFirst).toHaveBeenCalledWith({
        where: { id: 'elsewhere', conversationId: 'conv-1' },
        select: { id: true },
      });
    });

    it("403s a conversation I'm not in", async () => {
      await expect(
        errorBody(service.listMessages(otherAgent, 'conv-1', {})),
      ).resolves.toMatchObject({ status: 403 });
    });
  });

  describe('send', () => {
    beforeEach(() => {
      database.conversation.findUnique.mockResolvedValue(conversation);
      database.message.findUnique.mockResolvedValue(null);
      tx.$queryRaw.mockResolvedValue([{ status: OrderStatus.PREPARING }]);
      tx.message.create.mockResolvedValue(message);
    });

    it('saves, bumps lastMessageAt and notifies both sides', async () => {
      await expect(service.send(buyer, 'conv-1', send)).resolves.toEqual(
        message,
      );
      expect(tx.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          senderId: buyer.id,
          body: 'Hello',
          clientMessageId: 'client-1',
        },
      });
      expect(tx.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { lastMessageAt: created },
      });
      expect(chat.emitToUsers).toHaveBeenCalledWith(
        [buyer.id, agent.id],
        'message.created',
        message,
      );
    });

    it.each([OrderStatus.FULFILLED, OrderStatus.CANCELLED])(
      'refuses a new message once the order is %s',
      async (status) => {
        tx.$queryRaw.mockResolvedValue([{ status }]);
        await expect(
          errorBody(service.send(buyer, 'conv-1', send)),
        ).resolves.toMatchObject({
          status: 409,
          body: { code: 'CONVERSATION_CLOSED' },
        });
        expect(tx.message.create).not.toHaveBeenCalled();
        expect(chat.emitToUsers).not.toHaveBeenCalled();
      },
    );

    it('returns the original on a retry, without re-notifying', async () => {
      database.message.findUnique.mockResolvedValue(message);
      await expect(service.send(buyer, 'conv-1', send)).resolves.toEqual(
        message,
      );
      expect(tx.message.create).not.toHaveBeenCalled();
      expect(chat.emitToUsers).not.toHaveBeenCalled();
    });

    it('returns the original on a retry even after the order closed', async () => {
      database.message.findUnique.mockResolvedValue(message);
      tx.$queryRaw.mockResolvedValue([{ status: OrderStatus.FULFILLED }]);
      await expect(service.send(buyer, 'conv-1', send)).resolves.toEqual(
        message,
      );
    });

    it('returns the original when a retry races the first send', async () => {
      database.message.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(message);
      tx.message.create.mockRejectedValue(uniqueViolation());
      await expect(service.send(buyer, 'conv-1', send)).resolves.toEqual(
        message,
      );
    });

    it('refuses a clientMessageId already used in another conversation', async () => {
      database.message.findUnique.mockResolvedValue({
        ...message,
        conversationId: 'conv-2',
      });
      await expect(
        errorBody(service.send(buyer, 'conv-1', send)),
      ).resolves.toMatchObject({
        status: 409,
        body: { code: 'CLIENT_MESSAGE_ID_REUSED' },
      });
    });

    it('records an agent message and cuts the body at 120 characters', async () => {
      tx.agent.findUnique.mockResolvedValue({ id: 'agent-1' });
      tx.order.findUnique.mockResolvedValue({
        orderNumber: 'ORD-000001',
        farmId: 'farm-1',
      });
      const body = 'a'.repeat(150);
      await service.send(agent, conversation.id, {
        body,
        clientMessageId: 'msg-1',
      });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.EXTENSION_AGENT,
        farmerId: null,
        agentId: 'agent-1',
        farmId: 'farm-1',
        category: AuditCategory.CHAT,
        title: 'Message sent to buyer',
        summary: `ORD-000001. ${'a'.repeat(120)}`,
        actionLabel: 'View chat',
        resource: AuditResource.CONVERSATION,
        resourceId: conversation.id,
      });
    });

    it('a buyer message writes nothing', async () => {
      await service.send(buyer, conversation.id, {
        body: 'hello',
        clientMessageId: 'msg-2',
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a replayed agent message writes nothing', async () => {
      database.message.findUnique.mockResolvedValue({
        ...message,
        senderId: agent.id,
      });
      await service.send(agent, conversation.id, {
        body: 'hello',
        clientMessageId: 'msg-1',
      });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    beforeEach(() => {
      database.conversation.findUnique.mockResolvedValue(conversation);
      database.conversation.update.mockResolvedValue(conversationRow());
    });

    it("moves the buyer's read marker and tells both sides", async () => {
      await expect(service.markRead(buyer, 'conv-1')).resolves.toMatchObject({
        unreadCount: 0,
      });
      expect(database.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: { buyerLastReadAt: expect.any(Date) as unknown },
        }),
      );
      expect(chat.emitToUsers).toHaveBeenCalledWith(
        [buyer.id, agent.id],
        'conversation.read',
        expect.objectContaining({ conversationId: 'conv-1', userId: buyer.id }),
      );
    });

    it("moves the agent's read marker for the agent", async () => {
      await service.markRead(agent, 'conv-1');
      expect(database.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { agentLastReadAt: expect.any(Date) as unknown },
        }),
      );
    });
  });
});
