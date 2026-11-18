import 'dotenv/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import {
  CheckoutStatus,
  FarmVerificationStatus,
  OrderStatus,
  PackagingType,
  ProduceCondition,
  ProduceStatus,
  ProduceType,
  QualityGrade,
  Role,
  SourcingRequestStatus,
  SourcingUnit,
  type Order,
  type User,
} from '../generated/client';
import { AuditService } from '../src/audit/audit.service';
import { FirebaseService } from '../src/auth/firebase/firebase.service';
import { ChatGateway } from '../src/conversation/chat.gateway';
import { ConversationService } from '../src/conversation/conversation.service';
import type { MessageDto } from '../src/conversation/dto';
import { openSourcingConversation } from '../src/conversation/utils/sourcing-conversation';
import { PayoutConfig } from '../src/payout/payout.config';
import { PrismaService } from '../src/prisma/prisma.service';

// Runs against the docker compose Postgres and Redis; test/e2e-guard.ts
// refuses a non-local DATABASE_URL. Rows are tagged with this run's id and
// removed in afterAll. Firebase is faked: a token is the user's firebaseUid.
const run = randomUUID().slice(0, 8);

const firebase = {
  auth: {
    verifyIdToken: (token: string) =>
      Promise.resolve({
        uid: token,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
  },
};

async function startInstance() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    providers: [
      PrismaService,
      AuditService,
      PayoutConfig,
      ConversationService,
      ChatGateway,
      { provide: FirebaseService, useValue: firebase },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  return {
    app,
    url: await app.getUrl(),
    service: app.get(ConversationService),
  };
}

function connect(url: string, token: string): Promise<Socket> {
  const socket = io(`${url}/v1/chat`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) =>
    socket.once(event, (payload: T) => resolve(payload)),
  );
}

describe('Conversations (real Postgres + Redis)', () => {
  let a: Awaited<ReturnType<typeof startInstance>>;
  let b: Awaited<ReturnType<typeof startInstance>>;
  let db: PrismaService;
  const sockets: Socket[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const checkoutIds: string[] = [];
  const requestIds: string[] = [];
  let buyer: User;
  // Orders and conversations key on the Buyer profile, not the user.
  let buyerId: string;
  let agentUser: User;
  let agentId: string;
  let stateId: string;
  let lgaId: string;
  let farmId: string;
  let produceId: string;

  async function user(role: Role, extra: Partial<User> = {}) {
    const tag = `${run}-${randomUUID()}`;
    const created = await db.user.create({
      data: {
        firebaseUid: `e2e-${tag}`,
        email: `e2e-${tag}@example.com`,
        firstName: 'E2E',
        lastName: role,
        role,
        isVerified: true,
        ...extra,
      },
    });
    userIds.push(created.id);
    return created;
  }

  async function order(
    status: OrderStatus = OrderStatus.PENDING,
    extra: { checkoutId?: string; fulfilledAt?: Date } = {},
  ): Promise<Order> {
    const created = await db.order.create({
      data: {
        produceId,
        farmId,
        buyerId,
        quantity: 5,
        totalPrice: '500.00',
        agentCommission: '0.00',
        status,
        produceName: 'Cassava',
        type: ProduceType.LOCAL,
        ...extra,
      },
    });
    orderIds.push(created.id);
    return created;
  }

  async function sourcingRequest(
    status: SourcingRequestStatus = SourcingRequestStatus.FINDING_SUPPLY,
  ) {
    const created = await db.sourcingRequest.create({
      data: {
        buyerId,
        produceName: 'Maize',
        quantity: 12,
        unit: SourcingUnit.TONNES,
        quality: QualityGrade.GRADE_A,
        packaging: PackagingType.BAGS,
        condition: ProduceCondition.DRIED,
        deliveryDestination: 'Lagos',
        requiredDate: new Date('2027-01-15'),
        status,
        assignedAgentId: agentId,
      },
    });
    requestIds.push(created.id);
    await db.$transaction((tx) =>
      openSourcingConversation(tx, created, agentUser.id),
    );
    return created;
  }

  async function paidCheckout(sourcingRequestId: string) {
    const created = await db.checkout.create({
      data: {
        buyerId,
        idempotencyKey: randomUUID(),
        totalPrice: '1000.00',
        subtotal: '1000.00',
        deliveryFee: '0.00',
        serviceFee: '0.00',
        agentCommission: '0.00',
        status: CheckoutStatus.PAID,
        expiresAt: new Date(),
        paidAt: new Date(),
        deliveryDate: new Date('2027-01-15'),
        deliveryLabel: 'Warehouse',
        deliveryStreet: '1 Test Road',
        sourcingRequestId,
      },
    });
    checkoutIds.push(created.id);
    return created;
  }

  async function track(socket: Promise<Socket>) {
    const connected = await socket;
    sockets.push(connected);
    return connected;
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    db = a.app.get(PrismaService);
    const state = await db.state.create({ data: { name: `E2E State ${run}` } });
    const lga = await db.lga.create({
      data: { stateId: state.id, name: `E2E LGA ${run}` },
    });
    stateId = state.id;
    lgaId = lga.id;
    buyer = await user(Role.BUYER);
    ({ id: buyerId } = await db.buyer.create({ data: { userId: buyer.id } }));
    agentUser = await user(Role.EXTENSION_AGENT, { activatedAt: new Date() });
    const agent = await db.agent.create({
      data: { userId: agentUser.id, isVerified: true, cluster: { create: {} } },
      include: { cluster: true },
    });
    agentId = agent.id;
    const farmerUser = await user(Role.FARMER, { activatedAt: new Date() });
    const farmer = await db.farmer.create({ data: { userId: farmerUser.id } });
    const farm = await db.farm.create({
      data: {
        ownerId: farmer.id,
        name: `E2E Farm ${run}`,
        stateId,
        lgaId,
        location: '1 Test Road',
        size: 1,
        mainProduce: 'Cassava',
        verificationStatus: FarmVerificationStatus.VERIFIED,
        isClustered: true,
        clusterId: agent.cluster?.id,
      },
    });
    farmId = farm.id;
    const listing = await db.produce.create({
      data: {
        farmId,
        name: `E2E Cassava ${run}`,
        quantity: 100,
        actualQuantity: 100,
        floatingQuantity: 100,
        unit: 'tonnes',
        pricePerUnit: '100.00',
        status: ProduceStatus.PUBLISHED,
      },
    });
    produceId = listing.id;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    // Messages, conversations and orders restrict deletes, so they go first.
    await db.message.deleteMany({ where: { senderId: { in: userIds } } });
    await db.conversation.deleteMany({
      where: {
        OR: [
          { orderId: { in: orderIds } },
          { sourcingRequestId: { in: requestIds } },
        ],
      },
    });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.checkout.deleteMany({ where: { id: { in: checkoutIds } } });
    await db.sourcingRequest.deleteMany({ where: { id: { in: requestIds } } });
    await db.produce.deleteMany({ where: { farmId } });
    // The farm restricts its cluster's delete, which cascades from the agent's user.
    await db.farm.delete({ where: { id: farmId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.lga.delete({ where: { id: lgaId } });
    await db.state.delete({ where: { id: stateId } });
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it('opens one conversation when both sides open at once', async () => {
    const placed = await order();
    const [first, second] = await Promise.all([
      a.service.open(buyer, placed.id),
      b.service.open(agentUser, placed.id),
    ]);
    expect(second.id).toBe(first.id);
    await expect(
      db.conversation.count({ where: { orderId: placed.id } }),
    ).resolves.toBe(1);
    expect(first.unit).toBe('tonnes');
  });

  it('delivers a message sent on one instance to a socket on the other', async () => {
    const thread = await a.service.open(buyer, (await order()).id);
    const socket = await track(connect(a.url, buyer.firebaseUid));
    const received = nextEvent<MessageDto>(socket, 'message.created');

    const sent = await b.service.send(agentUser, thread.id, {
      body: 'Ready by Dec 12',
      clientMessageId: randomUUID(),
    });

    await expect(received).resolves.toMatchObject({
      id: sent.id,
      body: 'Ready by Dec 12',
    });
  });

  it('refuses a socket for an unregistered user', async () => {
    await expect(connect(a.url, `e2e-${run}-nobody`)).rejects.toMatchObject({
      message: 'Complete registration first',
      data: { code: 'FORBIDDEN', statusCode: 403 },
    });
  });

  it('pages history by cursor, oldest first, and counts unread', async () => {
    const thread = await a.service.open(buyer, (await order()).id);
    const sent: MessageDto[] = [];
    for (const body of ['one', 'two', 'three', 'four', 'five']) {
      sent.push(
        await a.service.send(agentUser, thread.id, {
          body,
          clientMessageId: randomUUID(),
        }),
      );
    }

    const latest = await a.service.listMessages(buyer, thread.id, { limit: 2 });
    expect(latest.map((m) => m.body)).toEqual(['four', 'five']);
    const older = await a.service.listMessages(buyer, thread.id, {
      before: latest[0].id,
      limit: 2,
    });
    expect(older.map((m) => m.body)).toEqual(['two', 'three']);
    const newer = await a.service.listMessages(buyer, thread.id, {
      after: sent[1].id,
      limit: 10,
    });
    expect(newer.map((m) => m.body)).toEqual(['three', 'four', 'five']);

    await expect(a.service.findOne(buyer, thread.id)).resolves.toMatchObject({
      unreadCount: 5,
    });
    await expect(
      a.service.findOne(agentUser, thread.id),
    ).resolves.toMatchObject({ unreadCount: 0 });
    await a.service.markRead(buyer, thread.id);
    await expect(a.service.findOne(buyer, thread.id)).resolves.toMatchObject({
      unreadCount: 0,
    });
  });

  it('lists active threads before silent ones', async () => {
    const silent = await a.service.open(buyer, (await order()).id);
    const active = await a.service.open(buyer, (await order()).id);
    await a.service.send(buyer, active.id, {
      body: 'hi',
      clientMessageId: randomUUID(),
    });
    const { data } = await a.service.findAll(buyer, { page: 1, perPage: 50 });
    const ids = data.map((c) => c.id);
    expect(ids.indexOf(active.id)).toBeLessThan(ids.indexOf(silent.id));
  });

  it('saves a retried send once', async () => {
    const thread = await a.service.open(buyer, (await order()).id);
    const request = { body: 'once', clientMessageId: randomUUID() };
    const [first, second] = await Promise.all([
      a.service.send(buyer, thread.id, request),
      b.service.send(buyer, thread.id, request),
    ]);
    expect(second.id).toBe(first.id);
    await expect(
      db.message.count({ where: { conversationId: thread.id } }),
    ).resolves.toBe(1);
  });

  it('becomes read-only when the order closes, but replays earlier sends', async () => {
    const placed = await order();
    const thread = await a.service.open(buyer, placed.id);
    const earlier = { body: 'before close', clientMessageId: randomUUID() };
    const saved = await a.service.send(buyer, thread.id, earlier);
    await db.order.update({
      where: { id: placed.id },
      data: { status: OrderStatus.FULFILLED },
    });

    await expect(
      a.service.send(buyer, thread.id, {
        body: 'after',
        clientMessageId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      a.service.send(buyer, thread.id, earlier),
    ).resolves.toMatchObject({
      id: saved.id,
    });
    await expect(a.service.findOne(buyer, thread.id)).resolves.toMatchObject({
      isClosed: true,
    });
  });

  describe('sourcing chat', () => {
    const longAgo = new Date('2020-01-01T00:00:00Z');
    const say = (body: string) => ({ body, clientMessageId: randomUUID() });

    it('is idempotent when opened twice', async () => {
      const request = await sourcingRequest();
      const again = await db.$transaction((tx) =>
        openSourcingConversation(tx, request, agentUser.id),
      );
      const thread = await a.service.findForSourcingRequest(buyer, request.id);
      expect(again.id).toBe(thread.id);
      await expect(
        db.conversation.count({ where: { sourcingRequestId: request.id } }),
      ).resolves.toBe(1);
    });

    it('returns the request conversation for a sourced order', async () => {
      const request = await sourcingRequest(SourcingRequestStatus.COMPLETED);
      const checkout = await paidCheckout(request.id);
      const placed = await order(OrderStatus.PREPARING, {
        checkoutId: checkout.id,
      });
      const thread = await a.service.findForSourcingRequest(
        agentUser,
        request.id,
      );
      await expect(a.service.open(buyer, placed.id)).resolves.toMatchObject({
        id: thread.id,
        orderId: null,
        sourcingRequestId: request.id,
        unit: SourcingUnit.TONNES,
        isClosed: false,
      });
      await expect(
        db.conversation.count({ where: { orderId: placed.id } }),
      ).resolves.toBe(0);
      const { data } = await a.service.findAll(buyer, { page: 1, perPage: 50 });
      expect(data.map((c) => c.id)).toContain(thread.id);
    });

    it('accepts messages while one sourced order is in its dispute window, and refuses once every one is closed', async () => {
      const request = await sourcingRequest(SourcingRequestStatus.COMPLETED);
      const checkout = await paidCheckout(request.id);
      await order(OrderStatus.FULFILLED, {
        checkoutId: checkout.id,
        fulfilledAt: longAgo,
      });
      const recent = await order(OrderStatus.FULFILLED, {
        checkoutId: checkout.id,
        fulfilledAt: new Date(),
      });
      const thread = await a.service.findForSourcingRequest(buyer, request.id);
      await expect(
        b.service.send(agentUser, thread.id, say('Delivered both lots')),
      ).resolves.toMatchObject({ body: 'Delivered both lots' });

      await db.order.update({
        where: { id: recent.id },
        data: { fulfilledAt: longAgo },
      });
      await expect(
        a.service.send(buyer, thread.id, say('too late')),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(a.service.findOne(buyer, thread.id)).resolves.toMatchObject({
        isClosed: true,
      });
    });

    it('closes the sourcing chat when the request is closed before payment', async () => {
      const request = await sourcingRequest(SourcingRequestStatus.NEGOTIATING);
      const thread = await a.service.findForSourcingRequest(buyer, request.id);
      await a.service.send(buyer, thread.id, say('Any news?'));
      await db.sourcingRequest.update({
        where: { id: request.id },
        data: { status: SourcingRequestStatus.CLOSED, closedAt: new Date() },
      });
      await expect(
        a.service.send(agentUser, thread.id, say('Sorry')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s a buyer who does not own the request', async () => {
      const request = await sourcingRequest();
      const stranger = await user(Role.BUYER);
      await db.buyer.create({ data: { userId: stranger.id } });
      await expect(
        a.service.findForSourcingRequest(stranger, request.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
