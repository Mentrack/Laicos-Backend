import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  OrderStatus,
  Role,
  type Conversation,
  type Message,
  type Prisma,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import {
  sourcingRequestIdForOrder,
  syncSourcingRequest,
} from '../sourcing-request/utils/sync-sourcing-request';
import { requireBuyer } from '../buyer/utils/require-buyer';
import {
  paginationMeta,
  resolvePagination,
  type PaginationQueryDto,
} from '../common/pagination';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CHAT_EVENTS, ChatGateway } from './chat.gateway';
import type {
  ConversationDto,
  ConversationReadEventDto,
  MessageDto,
  MessageQueryDto,
  SendMessageDto,
} from './dto';
import {
  CONVERSATION_INCLUDE,
  formatConversation,
  formatMessage,
  type ConversationRow,
} from './formatters/conversation.formatter';
import { isClosed } from './utils/conversation-window';

const ORDER_PARTICIPANTS = {
  buyerId: true,
  status: true,
  handover: { select: { agent: { select: { userId: true } } } },
  farm: {
    select: { cluster: { select: { agent: { select: { userId: true } } } } },
  },
} satisfies Prisma.OrderSelect;

@Injectable()
export class ConversationService {
  constructor(
    private readonly database: PrismaService,
    private readonly chat: ChatGateway,
    private readonly audit: AuditService,
  ) {}

  async open(user: User, orderId: string): Promise<ConversationDto> {
    // An existing thread keeps its stored agent, even if the farm has since
    // moved cluster.
    const existing = await this.database.conversation.findUnique({
      where: { orderId },
      include: CONVERSATION_INCLUDE,
    });
    if (existing) {
      return this.present(user, existing);
    }

    const order = await this.database.order.findUnique({
      where: { id: orderId },
      select: ORDER_PARTICIPANTS,
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      });
    }
    // The handover agent is fixed when the order is READY; before that, the
    // farm's cluster agent.
    const agentUserId =
      order.handover?.agent?.userId ?? order.farm.cluster?.agent.userId;
    // Checked first, so a stranger can't learn an order's payment status.
    const buyerId = await this.buyerIdFor(user);
    if (buyerId !== order.buyerId && user.id !== agentUserId) {
      throw notParticipant();
    }
    if (order.status === OrderStatus.AWAITING_PAYMENT) {
      throw new ConflictException({
        message: 'Messaging opens once the order is paid',
        code: 'CONVERSATION_NOT_OPEN',
      });
    }
    if (isClosed(order.status)) {
      throw conversationClosed();
    }
    if (!agentUserId) {
      throw new ConflictException({
        message: 'No agent is assigned to this order yet',
        code: 'NO_AGENT_ASSIGNED',
      });
    }

    try {
      const created = await this.database.conversation.create({
        data: { orderId, buyerId: order.buyerId, agentUserId },
        include: CONVERSATION_INCLUDE,
      });
      return formatConversation(created, user.id, 0);
    } catch (error) {
      // The other side opened it at the same moment; theirs won.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await this.database.conversation.findUniqueOrThrow({
        where: { orderId },
        include: CONVERSATION_INCLUDE,
      });
      return this.present(user, winner);
    }
  }

  async findOne(user: User, id: string): Promise<ConversationDto> {
    const row = await this.database.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) {
      throw conversationNotFound();
    }
    return this.present(user, row);
  }

  async findAll(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const buyerId = await this.buyerIdFor(user);
    const where = {
      OR: [...(buyerId ? [{ buyerId }] : []), { agentUserId: user.id }],
    } satisfies Prisma.ConversationWhereInput;
    const [rows, total] = await this.database.$transaction([
      this.database.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip,
        take,
      }),
      this.database.conversation.count({ where }),
    ]);
    if (rows.length === 0) {
      return { data: [], metaData: paginationMeta(page, perPage, total) };
    }
    const unread = await this.database.$transaction(
      rows.map((row) =>
        this.database.message.count({
          where: unreadWhere(row, user.id, buyerId),
        }),
      ),
    );
    return {
      data: rows.map((row, index) =>
        formatConversation(row, user.id, unread[index]),
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async listMessages(
    user: User,
    id: string,
    query: MessageQueryDto,
  ): Promise<MessageDto[]> {
    const conversation = await this.findParticipating(user, id);
    if (query.before && query.after) {
      throw invalidCursor('Use before or after, not both');
    }
    const cursorId = query.before ?? query.after;
    if (cursorId) {
      const cursor = await this.database.message.findFirst({
        where: { id: cursorId, conversationId: conversation.id },
        select: { id: true },
      });
      if (!cursor) {
        throw invalidCursor('Unknown message cursor');
      }
    }
    const limit = query.limit ?? 30;
    const messages = await this.database.message.findMany({
      where: { conversationId: conversation.id },
      // id breaks ties between messages saved in the same millisecond.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      // A negative take reads back from the cursor (or the newest message);
      // Prisma still returns the page in orderBy order.
      take: query.after ? limit : -limit,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return messages.map(formatMessage);
  }

  async send(user: User, id: string, dto: SendMessageDto): Promise<MessageDto> {
    const conversation = await this.findParticipating(user, id);
    // Before the closed check: a retry of a message saved before the order
    // closed must still get its original back.
    const replayed = await this.replay(user, id, dto.clientMessageId);
    if (replayed) {
      return replayed;
    }

    let message: Message;
    try {
      message = await this.database.$transaction(async (tx) => {
        // FOR SHARE: an order closing at this moment waits for this send to
        // commit, or this send sees it closed.
        const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
          SELECT status FROM "Order" WHERE id = ${conversation.orderId} FOR SHARE`;
        if (isClosed(order.status)) {
          throw conversationClosed();
        }
        const created = await tx.message.create({
          data: {
            conversationId: id,
            senderId: user.id,
            body: dto.body,
            clientMessageId: dto.clientMessageId,
          },
        });
        await tx.conversation.update({
          where: { id },
          data: { lastMessageAt: created.createdAt },
        });
        const sourcingRequestId = await sourcingRequestIdForOrder(
          tx,
          conversation.orderId,
        );
        if (user.role === Role.EXTENSION_AGENT) {
          const [agent, order] = await Promise.all([
            tx.agent.findUnique({
              where: { userId: user.id },
              select: { id: true },
            }),
            tx.order.findUnique({
              where: { id: conversation.orderId },
              select: { orderNumber: true, farmId: true },
            }),
          ]);
          await this.audit.record(tx, {
            actorType: AuditActorType.EXTENSION_AGENT,
            farmerId: null,
            agentId: agent!.id,
            farmId: order!.farmId,
            category: AuditCategory.CHAT,
            title: 'Message sent to buyer',
            summary: `${order!.orderNumber}. ${dto.body.slice(0, 120)}`,
            actionLabel: 'View chat',
            resource: AuditResource.CONVERSATION,
            resourceId: id,
            sourcingRequestId,
          });
        } else if (user.role === Role.BUYER && sourcingRequestId) {
          const order = await tx.order.findUnique({
            where: { id: conversation.orderId },
            select: { orderNumber: true },
          });
          await this.audit.record(tx, {
            actorType: AuditActorType.BUYER,
            farmerId: null,
            agentId: null,
            farmId: null,
            category: AuditCategory.CHAT,
            title: 'Message sent to agent',
            summary: `${order?.orderNumber ?? ''}. ${dto.body.slice(0, 120)}`,
            actionLabel: 'View chat',
            resource: AuditResource.CONVERSATION,
            resourceId: id,
            sourcingRequestId,
          });
        }
        if (sourcingRequestId) {
          await syncSourcingRequest(tx, sourcingRequestId);
        }
        return created;
      });
    } catch (error) {
      // A retry that raced the first send past the replay check above.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const original = await this.replay(user, id, dto.clientMessageId);
      if (!original) {
        throw error;
      }
      return original;
    }

    const result = formatMessage(message);
    this.chat.emitToUsers(
      [conversation.buyer.userId, conversation.agentUserId],
      CHAT_EVENTS.messageCreated,
      result,
    );
    return result;
  }

  async markRead(user: User, id: string): Promise<ConversationDto> {
    const conversation = await this.findParticipating(user, id);
    const buyerId = await this.buyerIdFor(user);
    const readAt = new Date();
    const row = await this.database.conversation.update({
      where: { id },
      data:
        buyerId !== null && conversation.buyerId === buyerId
          ? { buyerLastReadAt: readAt }
          : { agentLastReadAt: readAt },
      include: CONVERSATION_INCLUDE,
    });
    const event: ConversationReadEventDto = {
      conversationId: id,
      userId: user.id,
      readAt,
    };
    this.chat.emitToUsers(
      [row.buyer.userId, row.agentUserId],
      CHAT_EVENTS.conversationRead,
      event,
    );
    return formatConversation(row, user.id, 0);
  }

  /** The sender's earlier message with this clientMessageId, if any. */
  private async replay(
    user: User,
    conversationId: string,
    clientMessageId: string,
  ): Promise<MessageDto | null> {
    const original = await this.database.message.findUnique({
      where: {
        senderId_clientMessageId: { senderId: user.id, clientMessageId },
      },
    });
    if (!original) {
      return null;
    }
    if (original.conversationId !== conversationId) {
      throw new ConflictException({
        message:
          'This clientMessageId was already used in another conversation',
        code: 'CLIENT_MESSAGE_ID_REUSED',
      });
    }
    return formatMessage(original);
  }

  /** The conversation, or 404/403. Used by every per-thread route. */
  private async findParticipating(user: User, id: string) {
    const conversation = await this.database.conversation.findUnique({
      where: { id },
      include: { buyer: { select: { userId: true } } },
    });
    if (!conversation) {
      throw conversationNotFound();
    }
    await this.assertParticipant(user, conversation);
    return conversation;
  }

  private async present(
    user: User,
    row: ConversationRow,
  ): Promise<ConversationDto> {
    await this.assertParticipant(user, row);
    const buyerId = await this.buyerIdFor(user);
    const unread = await this.database.message.count({
      where: unreadWhere(row, user.id, buyerId),
    });
    return formatConversation(row, user.id, unread);
  }

  private async buyerIdFor(user: User): Promise<string | null> {
    if (user.role !== Role.BUYER) {
      return null;
    }
    return (await requireBuyer(this.database, user)).id;
  }

  private async assertParticipant(
    user: User,
    conversation: Participants,
  ): Promise<void> {
    const buyerId = await this.buyerIdFor(user);
    if (
      (buyerId === null || conversation.buyerId !== buyerId) &&
      user.id !== conversation.agentUserId
    ) {
      throw notParticipant();
    }
  }
}

type Participants = Pick<
  Conversation,
  'id' | 'buyerId' | 'agentUserId' | 'buyerLastReadAt' | 'agentLastReadAt'
>;

function unreadWhere(
  conversation: Participants,
  userId: string,
  viewerBuyerId: string | null,
): Prisma.MessageWhereInput {
  const lastReadAt =
    viewerBuyerId !== null && conversation.buyerId === viewerBuyerId
      ? conversation.buyerLastReadAt
      : conversation.agentLastReadAt;
  return {
    conversationId: conversation.id,
    senderId: { not: userId },
    ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
  };
}

function conversationNotFound(): NotFoundException {
  return new NotFoundException({
    message: 'Conversation not found',
    code: 'CONVERSATION_NOT_FOUND',
  });
}

function notParticipant(): ForbiddenException {
  return new ForbiddenException({
    message: 'You are not part of this conversation',
    code: 'NOT_A_PARTICIPANT',
  });
}

export function conversationClosed(): ConflictException {
  return new ConflictException({
    message: 'This conversation is closed',
    code: 'CONVERSATION_CLOSED',
  });
}

function invalidCursor(message: string): BadRequestException {
  return new BadRequestException({ message, code: 'INVALID_CURSOR' });
}
