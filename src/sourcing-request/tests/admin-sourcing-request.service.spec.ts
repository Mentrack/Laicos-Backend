import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AuditActorType,
  AuditCategory,
  BuyerType,
  CheckoutStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  ProduceStatus,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { addDays, lagosToday } from '../../common/dates';
import { collect } from '../../common/tests/collect';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminSourcingRequestService } from '../admin-sourcing-request.service';
import { AdminSourcingFilterDto } from '../dto/admin-sourcing-request.dto';

const admin = { id: 'admin-1' } as User;
const requestId = '11111111-1111-4111-8111-111111111111';
const buyerId = 'buyer-1';
const agentId = 'agent-1';
const idempotencyKey = '22222222-2222-4222-8222-222222222222';

function offerFarm() {
  return {
    farmCode: 'LF-000001',
    name: 'Green Farm',
    owner: { user: { firstName: 'Ada', lastName: 'Okafor' } },
  };
}

function requestRow(overrides: Record<string, unknown> = {}, selected = 10) {
  return {
    id: requestId,
    requestNumber: 'REQ-000001',
    buyerId,
    produceName: 'White maize',
    quantity: 10,
    unit: SourcingUnit.BAGS,
    quality: null,
    packaging: null,
    condition: null,
    additionalSpecs: null,
    deliveryDestination: 'Kano',
    requiredDate: new Date('2026-11-01T00:00:00.000Z'),
    timeline: null,
    logisticsNotes: null,
    status: SourcingRequestStatus.FINDING_SUPPLY,
    assignedAgentId: agentId,
    escalatedAt: null,
    closedAt: null,
    closeReason: null,
    allocations: [
      {
        id: 'offer-0',
        farmId: 'farm-1',
        quantity: selected,
        unit: SourcingUnit.BAGS,
        status: SourcingOfferStatus.ACCEPTED,
        agreedUnitPrice: null,
        farm: offerFarm(),
      },
    ],
    checkouts: [],
    buyer: {
      id: buyerId,
      buyerId: 'BY-000001',
      buyerType: BuyerType.PERSON,
      legalName: null,
      department: null,
      contactName: null,
      contactPhone: null,
      paymentTerms: null,
      user: { firstName: 'Ada', lastName: 'Okafor', phoneNumber: '0800' },
      state: { name: 'Lagos' },
      lga: { name: 'Ikeja' },
    },
    assignedAgent: {
      id: agentId,
      agentId: 'AG-000001',
      user: { firstName: 'Tunde', lastName: 'Bello' },
      cluster: { id: 'cluster-1', name: 'Kano', clusterCode: 'CL-000001' },
    },
    ...overrides,
  };
}

function placedCheckout() {
  return {
    id: 'checkout-1',
    checkoutNumber: 'CHK-000001',
    buyerId,
    status: CheckoutStatus.AWAITING_PAYMENT,
    subtotal: new Prisma.Decimal('1000.00'),
    deliveryFee: new Prisma.Decimal('3500.00'),
    serviceFee: new Prisma.Decimal('0.00'),
    agentCommission: new Prisma.Decimal('0.00'),
    totalPrice: new Prisma.Decimal('4500.00'),
    expiresAt: new Date('2026-10-16T12:00:00.000Z'),
    paidAt: null,
    deliveryDate: new Date('2026-10-17T00:00:00.000Z'),
    deliveryLabel: 'HQ',
    deliveryStreet: '1 Road',
    deliveryState: 'Lagos',
    deliveryLga: 'Ikeja',
    deliveryContactName: null,
    deliveryContactPhone: null,
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
    sourcingRequestId: requestId,
    orders: [],
    payments: [],
  };
}

describe('AdminSourcingRequestService', () => {
  const sourcingRequest = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    update: jest.fn(),
  };
  const sourcingAllocation = {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  };
  const produce = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const agent = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() };
  const checkout = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const order = { findMany: jest.fn(), updateMany: jest.fn() };
  const address = { findFirst: jest.fn() };
  const payment = { updateMany: jest.fn() };
  const cartItem = { deleteMany: jest.fn() };
  const auditEvent = { createMany: jest.fn() };
  const sourcingContract = { updateMany: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    sourcingRequest,
    sourcingAllocation,
    produce,
    agent,
    checkout,
    order,
    address,
    payment,
    cartItem,
    auditEvent,
    sourcingContract,
  };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
      _options?: unknown,
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const audit = { record: jest.fn(), findForRequest: jest.fn() };
  const notifications = { notify: jest.fn(), dispatch: jest.fn() };
  const service = new AdminSourcingRequestService(
    database as unknown as PrismaService,
    audit as unknown as AuditService,
    notifications as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    audit.findForRequest.mockResolvedValue({ data: [], metaData: {} });
    notifications.notify.mockResolvedValue(['delivery-1']);
    order.findMany.mockResolvedValue([]);
    sourcingRequest.findUnique.mockImplementation(
      (args: { include?: { buyer?: unknown }; select?: unknown }) => {
        if (args.include?.buyer) {
          return requestRow();
        }
        if (args.select) {
          return {
            closedAt: null,
            closeReason: null,
            assignedAgentId: agentId,
            _count: { allocations: 1 },
            checkouts: [],
          };
        }
        return requestRow();
      },
    );
  });

  it('exposes the request-level conversation id', async () => {
    sourcingRequest.findUnique.mockImplementation(() =>
      requestRow({ conversation: { id: 'conversation-1' } }),
    );
    const detail = await service.findOne(requestId);
    expect(detail.conversationId).toBe('conversation-1');
    expect(detail.orders).toEqual([]);
  });

  it('has a null conversation id before the agent accepts', async () => {
    const detail = await service.findOne(requestId);
    expect(detail.conversationId).toBeNull();
  });

  it('counts only accepted offers towards coverage and shows each offer state', async () => {
    const offer = (
      id: string,
      quantity: number,
      status: SourcingOfferStatus,
      agreedUnitPrice: Prisma.Decimal | null,
    ) => ({
      id,
      farmId: 'farm-1',
      quantity,
      unit: SourcingUnit.BAGS,
      status,
      agreedUnitPrice,
      farm: offerFarm(),
    });
    sourcingRequest.findUnique.mockImplementation(() =>
      requestRow({
        allocations: [
          offer(
            'offer-1',
            4,
            SourcingOfferStatus.ACCEPTED,
            new Prisma.Decimal('120'),
          ),
          offer('offer-2', 5, SourcingOfferStatus.OFFERED, null),
          offer('offer-3', 6, SourcingOfferStatus.REJECTED, null),
        ],
      }),
    );

    const detail = await service.findOne(requestId);

    expect(detail.coverage).toEqual({
      requested: 10,
      selected: 4,
      remaining: 6,
    });
    expect(detail.allocations).toEqual([
      {
        id: 'offer-1',
        status: SourcingOfferStatus.ACCEPTED,
        agreedUnitPrice: '120.00',
        farmId: 'farm-1',
        farmCode: 'LF-000001',
        farmName: 'Green Farm',
        farmerName: 'Ada Okafor',
        quantity: 4,
        unit: SourcingUnit.BAGS,
      },
      expect.objectContaining({
        id: 'offer-2',
        status: SourcingOfferStatus.OFFERED,
        agreedUnitPrice: null,
      }),
      expect.objectContaining({
        id: 'offer-3',
        status: SourcingOfferStatus.REJECTED,
      }),
    ]);
  });

  it("exposes the assigned agent's cluster code", async () => {
    const detail = await service.findOne(requestId);

    expect(detail.assignment).toMatchObject({
      clusterName: 'Kano',
      clusterCode: 'CL-000001',
    });
  });

  it('requires every search token to match', async () => {
    sourcingRequest.findMany.mockResolvedValue([]);
    sourcingRequest.count.mockResolvedValue(0);
    await service.findAll({ search: 'Ada Okafor', page: 1, perPage: 20 });
    expect(sourcingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ OR: expect.any(Array) }, { OR: expect.any(Array) }],
        },
      }),
    );
  });

  it('maps a list row', async () => {
    const createdAt = new Date('2026-10-09T23:30:00.000Z');
    sourcingRequest.findMany.mockResolvedValue([requestRow({ createdAt })]);
    sourcingRequest.count.mockResolvedValue(1);

    const { data } = await service.findAll({ page: 1, perPage: 20 });

    expect(sourcingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(data).toEqual([
      {
        id: requestId,
        requestNumber: 'REQ-000001',
        buyerName: 'Ada Okafor',
        produceName: 'White maize',
        quantity: 10,
        unit: SourcingUnit.BAGS,
        deliveryDestination: 'Kano',
        agentName: 'Tunde Bello',
        agentCode: 'AG-000001',
        status: SourcingRequestStatus.FINDING_SUPPLY,
        createdAt,
        escalated: false,
        shipment: null,
      },
    ]);
  });

  describe('exportCsv', () => {
    it('writes every matching request, unpaginated, newest first', async () => {
      sourcingRequest.findMany.mockResolvedValue([
        requestRow({
          status: SourcingRequestStatus.PENDING,
          assignedAgent: null,
          escalatedAt: new Date('2026-10-09T12:00:00.000Z'),
          createdAt: new Date('2026-10-09T23:30:00.000Z'),
        }),
      ]);

      const csv = await collect(
        service.exportCsv({ status: SourcingRequestStatus.PENDING }),
      );

      expect(csv).toBe(
        'Request ID,Buyer,Produce,Quantity,Unit,Destination,Agent,Agent ID,Status,Shipment,Escalated,Date\r\n' +
          'REQ-000001,Ada Okafor,White maize,10,BAGS,Kano,,,PENDING,,Yes,2026-10-10\r\n',
      );
      const args = sourcingRequest.findMany.mock.calls[0][0] as object;
      expect(args).toEqual(
        expect.objectContaining({
          where: { status: SourcingRequestStatus.PENDING },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1000,
        }),
      );
    });

    it('refuses paging on the export filters', async () => {
      const dto = plainToInstance(AdminSourcingFilterDto, { page: 2 });
      const [error] = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(error?.property).toBe('page');
    });
  });

  it('releases an unpaid checkout when the request is closed', async () => {
    sourcingRequest.findUnique.mockImplementation(
      (args: { include?: { buyer?: unknown }; select?: unknown }) => {
        if (args.include?.buyer) {
          return requestRow({
            status: SourcingRequestStatus.CLOSED,
            closedAt: new Date(),
          });
        }
        if (args.select) {
          return {
            closedAt: new Date(),
            closeReason: 'Buyer withdrew',
            assignedAgentId: agentId,
            _count: { allocations: 1 },
            checkouts: [],
          };
        }
        return requestRow({ status: SourcingRequestStatus.CONFIRMED });
      },
    );
    checkout.findFirst.mockResolvedValue({
      id: 'checkout-1',
      status: CheckoutStatus.AWAITING_PAYMENT,
    });
    checkout.update.mockResolvedValue(placedCheckout());
    order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNumber: 'ORD-000001',
        farmId: 'farm-1',
        produceId: 'produce-1',
        quantity: 2,
        status: OrderStatus.AWAITING_PAYMENT,
      },
    ]);
    produce.update.mockResolvedValue({
      id: 'produce-1',
      status: ProduceStatus.PUBLISHED,
      actualQuantity: 10,
      floatingQuantity: 10,
    });
    await service.close(admin, requestId, { reason: 'Buyer withdrew' });
    expect(order.findMany).toHaveBeenCalled();
    expect(auditEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          actorType: AuditActorType.ADMIN,
          actorUserId: 'admin-1',
          orderId: 'order-1',
          summary: 'Buyer withdrew',
        }),
      ],
    });
    expect(checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CheckoutStatus.CANCELLED }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: 'admin-1',
        title: 'Request closed',
        summary: 'Buyer withdrew. Unpaid checkout released',
      }),
    );
  });

  describe('assign', () => {
    const asAgent = (isVerified = true) =>
      agent.findUnique.mockResolvedValue({
        id: agentId,
        userId: 'agent-user-1',
        agentId: 'AG-000001',
        isVerified,
        user: { firstName: 'Tunde', lastName: 'Bello' },
      });
    const withStatus = (
      status: SourcingRequestStatus,
      assignedAgentId = null,
    ) =>
      sourcingRequest.findUnique.mockImplementation(() =>
        requestRow({ status, assignedAgentId }),
      );

    it('assigns a PENDING request, starts the window and notifies the agent', async () => {
      asAgent();
      withStatus(SourcingRequestStatus.PENDING);
      await service.assign(admin, requestId, { agentId });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.ASSIGNED },
      });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { assignedAgentId: agentId, assignedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          category: AuditCategory.ASSIGNMENT,
          title: 'Agent assigned',
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['agent-user-1'],
          type: NotificationType.SOURCING_ASSIGNED,
          params: {
            requestId,
            requestNumber: 'REQ-000001',
            produceName: 'White maize',
          },
        },
        tx,
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('resets assignedAt on a reassignment from ASSIGNED', async () => {
      asAgent();
      withStatus(SourcingRequestStatus.ASSIGNED, 'agent-0' as never);
      await service.assign(admin, requestId, { agentId });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { assignedAgentId: agentId, assignedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ title: 'Agent reassigned' }),
      );
    });

    it.each([
      SourcingRequestStatus.FINDING_SUPPLY,
      SourcingRequestStatus.NEGOTIATING,
      SourcingRequestStatus.CONFIRMED,
      SourcingRequestStatus.COMPLETED,
    ])('refuses %s with 409', async (status) => {
      asAgent();
      withStatus(status);
      await expect(
        service.assign(admin, requestId, { agentId }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.dispatch).not.toHaveBeenCalled();
    });

    it('refuses an unverified agent with 409', async () => {
      asAgent(false);
      withStatus(SourcingRequestStatus.PENDING);
      await expect(
        service.assign(admin, requestId, { agentId }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown agent with 404', async () => {
      agent.findUnique.mockResolvedValue(null);
      withStatus(SourcingRequestStatus.PENDING);
      await expect(
        service.assign(admin, requestId, { agentId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('close', () => {
    const withStatus = (status: SourcingRequestStatus) =>
      sourcingRequest.findUnique.mockImplementation(() =>
        requestRow({ status }),
      );

    it.each([
      SourcingRequestStatus.COMPLETED,
      SourcingRequestStatus.FULFILLED,
      SourcingRequestStatus.CLOSED,
    ])('refuses %s with 409', async (status) => {
      withStatus(status);
      await expect(
        service.close(admin, requestId, { reason: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it.each([
      SourcingRequestStatus.PENDING,
      SourcingRequestStatus.ASSIGNED,
      SourcingRequestStatus.FINDING_SUPPLY,
      SourcingRequestStatus.NEGOTIATING,
      SourcingRequestStatus.CONFIRMED,
    ])('closes from %s', async (status) => {
      withStatus(status);
      checkout.findFirst.mockResolvedValue(null);
      await service.close(admin, requestId, { reason: 'x' });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.CLOSED },
      });
    });

    it('voids the live contract when closing a CONFIRMED request', async () => {
      withStatus(SourcingRequestStatus.CONFIRMED);
      checkout.findFirst.mockResolvedValue(null);
      await service.close(admin, requestId, { reason: 'x' });
      expect(sourcingContract.updateMany).toHaveBeenCalledWith({
        where: { sourcingRequestId: requestId, voidedAt: null },
        data: { voidedAt: expect.any(Date) },
      });
    });

    it('takes the sourcing lock, then the checkout lock, before writing the request', async () => {
      // The payment webhook locks the checkout and then writes the request
      // row; taking the checkout lock first here avoids a deadlock with it.
      withStatus(SourcingRequestStatus.CONFIRMED);
      checkout.findFirst.mockResolvedValue({
        id: 'checkout-1',
        status: CheckoutStatus.AWAITING_PAYMENT,
      });
      checkout.update.mockResolvedValue(placedCheckout());
      order.findMany.mockResolvedValue([]);
      await service.close(admin, requestId, { reason: 'x' });

      const lockKeys = tx.$executeRaw.mock.calls.map(
        (call: unknown[]) => call[1],
      );
      expect(lockKeys).toEqual([
        `sourcing:${requestId}`,
        'checkout:checkout-1',
      ]);
      const checkoutLockAt = tx.$executeRaw.mock.invocationCallOrder[1];
      const firstRequestWrite = Math.min(
        ...sourcingRequest.update.mock.invocationCallOrder,
      );
      expect(checkoutLockAt).toBeLessThan(firstRequestWrite);
    });
  });

  describe('escalate', () => {
    const withStatus = (status: SourcingRequestStatus) =>
      sourcingRequest.findUnique.mockImplementation(() =>
        requestRow({ status }),
      );

    it.each([SourcingRequestStatus.FULFILLED, SourcingRequestStatus.CLOSED])(
      'refuses %s',
      async (status) => {
        withStatus(status);
        await expect(service.escalate(admin, requestId)).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );

    it('allows a COMPLETED request', async () => {
      withStatus(SourcingRequestStatus.COMPLETED);
      await service.escalate(admin, requestId);
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { escalatedAt: expect.any(Date) },
      });
    });
  });

  it('does not write a second escalate row', async () => {
    sourcingRequest.findUnique.mockImplementation(
      (args: { include?: { buyer?: unknown } }) => {
        if (args.include?.buyer) {
          return requestRow({ escalatedAt: new Date() });
        }
        return requestRow({ escalatedAt: new Date() });
      },
    );
    await service.escalate(admin, requestId);
    expect(audit.record).not.toHaveBeenCalled();
    expect(sourcingRequest.update).not.toHaveBeenCalled();
  });
});
