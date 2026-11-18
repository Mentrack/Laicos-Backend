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
  DisputeStatus,
  OrderStatus,
  Role,
  type Conversation,
  type Message,
  type Prisma,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { requireBuyer } from '../buyer/utils/require-buyer';
import { advisoryLock } from '../common/advisory-lock';
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
import { PayoutConfig } from '../payout/payout.config';
import {
  WINDOW_ORDER_SELECT,
  isClosed,
  sourcingChatClosed,
} from './utils/conversation-window';
import {
  SOURCING_CHAT_SELECT,
  paidOrders,
} from './utils/sourcing-conversation';

const ORDER_PARTICIPANTS = {
  ...WINDOW_ORDER_SELECT,
  buyerId: true,
  checkout: { select: { sourcingRequestId: true } },
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
    private readonly payoutConfig: PayoutConfig,
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
    // A sourced order shares its request's chat, opened when the agent accepted.
    const sourcingRequestId = order.checkout?.sourcingRequestId;
    if (sourcingRequestId) {
      return this.openSourced(user, order.buyerId, sourcingRequestId);
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
    if (isClosed(order, this.payoutConfig.holdHours, new Date())) {
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
      return formatConversation(
        created,
        user.id,
        0,
        this.payoutConfig.holdHours,
      );
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

  async findForSourcingRequest(
    user: User,
    requestId: string,
  ): Promise<ConversationDto> {
    const request = await this.database.sourcingRequest.findUnique({
      where: { id: requestId },
      select: { buyerId: true, assignedAgent: { select: { userId: true } } },
    });
    const buyerId = await this.buyerIdFor(user);
    // 404, not 403, so a stranger can't tell the request exists.
    if (
      !request ||
      (request.buyerId !== buyerId && request.assignedAgent?.userId !== user.id)
    ) {
      throw new NotFoundException({
        message: 'Sourcing request not found',
        code: 'SOURCING_REQUEST_NOT_FOUND',
      });
    }
    const row = await this.database.conversation.findUnique({
      where: { sourcingRequestId: requestId },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) {
      throw sourcingChatNotOpen();
    }
    return this.present(user, row);
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
        formatConversation(
          row,
          user.id,
          unread[index],
          this.payoutConfig.holdHours,
        ),
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
    // Before the closed check: a retry of a message saved before the chat
    // closed must still get its original back.
    const replayed = await this.replay(user, id, dto.clientMessageId);
    if (replayed) {
      return replayed;
    }

    let message: Message;
    try {
      message = await this.database.$transaction(async (tx) => {
        const subject = await this.lockOpenSubject(tx, conversation);
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
        const { sourcingRequestId } = subject;
        const summary = `${subject.label}. ${dto.body.slice(0, 120)}`;
        if (user.role === Role.EXTENSION_AGENT) {
          const agent = await tx.agent.findUnique({
            where: { userId: user.id },
            select: { id: true },
          });
          await this.audit.record(tx, {
            actorType: AuditActorType.EXTENSION_AGENT,
            actorUserId: user.id,
            farmerId: null,
            agentId: agent!.id,
            farmId: subject.farmId,
            category: AuditCategory.CHAT,
            title: 'Message sent to buyer',
            summary,
            actionLabel: 'View chat',
            resource: AuditResource.CONVERSATION,
            resourceId: id,
            sourcingRequestId,
          });
        } else if (user.role === Role.BUYER && sourcingRequestId) {
          await this.audit.record(tx, {
            actorType: AuditActorType.BUYER,
            actorUserId: user.id,
            farmerId: null,
            agentId: null,
            farmId: null,
            category: AuditCategory.CHAT,
            title: 'Message sent to agent',
            summary,
            actionLabel: 'View chat',
            resource: AuditResource.CONVERSATION,
            resourceId: id,
            sourcingRequestId,
          });
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
    return formatConversation(row, user.id, 0, this.payoutConfig.holdHours);
  }

  private async openSourced(
    user: User,
    orderBuyerId: string,
    sourcingRequestId: string,
  ): Promise<ConversationDto> {
    const row = await this.database.conversation.findUnique({
      where: { sourcingRequestId },
      include: CONVERSATION_INCLUDE,
    });
    if (row) {
      return this.present(user, row);
    }
    if ((await this.buyerIdFor(user)) !== orderBuyerId) {
      throw notParticipant();
    }
    throw sourcingChatNotOpen();
  }

  /**
   * Locks what the chat hangs off and refuses it if closed. Returns what the
   * audit row needs.
   */
  private lockOpenSubject(
    tx: Prisma.TransactionClient,
    conversation: Pick<Conversation, 'id' | 'orderId' | 'sourcingRequestId'>,
  ): Promise<ChatSubject> {
    if (conversation.orderId) {
      return this.lockOrderChat(tx, conversation.orderId);
    }
    // A CHECK constraint makes every conversation belong to exactly one of the two.
    if (!conversation.sourcingRequestId) {
      throw new Error(
        `Conversation ${conversation.id} has no order or sourcing request`,
      );
    }
    return this.lockSourcingChat(tx, conversation.sourcingRequestId);
  }

  private async lockOrderChat(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<ChatSubject> {
    // FOR SHARE: an order closing at this moment waits for this send to
    // commit, or this send sees it closed.
    const [row] = await tx.$queryRaw<
      {
        status: OrderStatus;
        fulfilledAt: Date | null;
        disputeStatus: DisputeStatus | null;
        orderNumber: string;
        farmId: string;
        sourcingRequestId: string | null;
      }[]
    >`
      SELECT o.status, o."fulfilledAt", d.status AS "disputeStatus",
        o."orderNumber", o."farmId", c."sourcingRequestId"
      FROM "Order" o
      LEFT JOIN "Dispute" d ON d."orderId" = o.id
      LEFT JOIN "Checkout" c ON c.id = o."checkoutId"
      WHERE o.id = ${orderId}
      FOR SHARE OF o`;
    const order = {
      status: row.status,
      fulfilledAt: row.fulfilledAt,
      dispute: row.disputeStatus ? { status: row.disputeStatus } : null,
    };
    if (isClosed(order, this.payoutConfig.holdHours, new Date())) {
      throw conversationClosed();
    }
    return {
      label: row.orderNumber,
      farmId: row.farmId,
      sourcingRequestId: row.sourcingRequestId,
    };
  }

  private async lockSourcingChat(
    tx: Prisma.TransactionClient,
    requestId: string,
  ): Promise<ChatSubject> {
    // The admin close takes the same lock, so a request closing at this
    // moment waits for this send to commit, or this send sees it closed.
    await advisoryLock(tx, `sourcing:${requestId}`);
    const request = await tx.sourcingRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { ...SOURCING_CHAT_SELECT, requestNumber: true },
    });
    if (
      sourcingChatClosed(
        request,
        paidOrders(request),
        this.payoutConfig.holdHours,
        new Date(),
      )
    ) {
      throw conversationClosed();
    }
    return {
      label: request.requestNumber,
      farmId: null,
      sourcingRequestId: requestId,
    };
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
    return formatConversation(
      row,
      user.id,
      unread,
      this.payoutConfig.holdHours,
    );
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

type ChatSubject = {
  /** The order or request number that heads the audit summary. */
  label: string;
  farmId: string | null;
  sourcingRequestId: string | null;
};

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

function sourcingChatNotOpen(): ConflictException {
  return new ConflictException({
    message: 'Messaging opens once an agent accepts the request',
    code: 'CONVERSATION_NOT_OPEN',
  });
}

function invalidCursor(message: string): BadRequestException {
  return new BadRequestException({ message, code: 'INVALID_CURSOR' });
}
