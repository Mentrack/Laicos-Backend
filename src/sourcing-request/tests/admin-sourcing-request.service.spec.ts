import { ConflictException } from '@nestjs/common';
import {
  BuyerType,
  CheckoutStatus,
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { addDays, lagosToday } from '../../common/dates';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminSourcingRequestService } from '../admin-sourcing-request.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const buyerId = 'buyer-1';
const agentId = 'agent-1';
const idempotencyKey = '22222222-2222-4222-8222-222222222222';

function listing(quantity = 20) {
  return {
    id: produceId,
    name: 'White maize',
    unit: 'bags',
    status: ProduceStatus.PUBLISHED,
    floatingQuantity: quantity,
    actualQuantity: quantity,
    farmId: 'farm-1',
    type: ProduceType.LOCAL,
    pricePerUnit: new Prisma.Decimal('100.00'),
    farm: {
      farmCode: 'LF-000001',
      name: 'Green Farm',
      clusterId: 'cluster-1',
      verificationStatus: FarmVerificationStatus.VERIFIED,
      cluster: { id: 'cluster-1' },
      owner: { user: { firstName: 'Ada', lastName: 'Okafor' } },
    },
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
        produceId,
        quantity: selected,
        produce: listing(),
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
      cluster: { id: 'cluster-1', name: 'Kano' },
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
  };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
      _options?: unknown,
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const audit = { record: jest.fn(), findForRequest: jest.fn() };
  const service = new AdminSourcingRequestService(
    database as unknown as PrismaService,
    audit as unknown as AuditService,
    testCheckoutConfig(),
  );

  beforeEach(() => {
    jest.resetAllMocks();
    audit.findForRequest.mockResolvedValue({ data: [], metaData: {} });
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

  it('drops a listing whose name is not the requested produce', async () => {
    agent.findUnique.mockResolvedValue({
      id: agentId,
      cluster: { id: 'cluster-1' },
    });
    produce.findMany.mockResolvedValue([
      listing(),
      { ...listing(), id: 'other', name: 'White maize flour' },
    ]);
    const rows = await service.listings(requestId);
    expect(rows.map((row) => row.name)).toEqual(['White maize']);
  });

  it('refuses matching before an agent is assigned', async () => {
    sourcingRequest.findUnique.mockResolvedValue(
      requestRow({ assignedAgentId: null }),
    );
    await expect(service.listings(requestId)).rejects.toThrow(
      'Assign an agent before matching listings',
    );
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

  it('refuses to replace the selection after a checkout is placed', async () => {
    sourcingRequest.findUnique.mockResolvedValue(
      requestRow({ status: SourcingRequestStatus.AWAITING_BUYER }),
    );
    await expect(service.save(requestId, { items: [] })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sourcingAllocation.deleteMany).not.toHaveBeenCalled();
  });

  it('writes one audit row when the saved group changes', async () => {
    agent.findUniqueOrThrow.mockResolvedValue({
      id: agentId,
      cluster: { id: 'cluster-1' },
    });
    sourcingAllocation.findMany.mockResolvedValue([]);
    produce.findUnique.mockResolvedValue(listing());
    await service.save(requestId, {
      items: [{ produceId, quantity: 10 }],
    });
    expect(sourcingAllocation.deleteMany).toHaveBeenCalled();
    expect(sourcingAllocation.createMany).toHaveBeenCalledWith({
      data: [{ sourcingRequestId: requestId, produceId, quantity: 10 }],
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ title: 'Supply selection updated' }),
    );
  });

  it('writes nothing when the saved group is unchanged', async () => {
    agent.findUniqueOrThrow.mockResolvedValue({
      id: agentId,
      cluster: { id: 'cluster-1' },
    });
    sourcingAllocation.findMany.mockResolvedValue([
      { produceId, quantity: 10 },
    ]);
    produce.findUnique.mockResolvedValue(listing());
    await service.save(requestId, {
      items: [{ produceId, quantity: 10 }],
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not reserve stock when the selection is short', async () => {
    sourcingRequest.findUnique.mockImplementation(
      (args: { include?: { allocations?: unknown }; select?: unknown }) => {
        if (args.include?.allocations) {
          return requestRow({}, 4);
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
        return requestRow({}, 4);
      },
    );
    checkout.findUnique.mockResolvedValue(null);
    await expect(
      service.confirm(requestId, idempotencyKey, {
        addressId: 'address-1',
        deliveryDate: addDays(lagosToday(), 2),
        expectedTotal: 4500,
      }),
    ).rejects.toThrow('The selection does not cover the request');
    expect(produce.updateMany).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();
    expect(cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('places one checkout for the saved group and leaves the cart', async () => {
    sourcingRequest.findUnique.mockImplementation(
      (args: {
        include?: { allocations?: unknown; buyer?: unknown };
        select?: unknown;
      }) => {
        if (args.select) {
          return {
            closedAt: null,
            closeReason: null,
            assignedAgentId: agentId,
            _count: { allocations: 1 },
            checkouts: [
              { status: CheckoutStatus.AWAITING_PAYMENT, orders: [] },
            ],
          };
        }
        if (args.include?.buyer) {
          return requestRow();
        }
        if (args.include?.allocations) {
          return requestRow();
        }
        return requestRow();
      },
    );
    checkout.findUnique.mockResolvedValue(null);
    address.findFirst.mockResolvedValue({
      id: 'address-1',
      label: 'HQ',
      street: '1 Road',
      contactName: null,
      contactPhone: null,
      state: { name: 'Lagos' },
      lga: { name: 'Ikeja' },
    });
    produce.updateMany.mockResolvedValue({ count: 1 });
    produce.findUnique.mockResolvedValue(listing());
    checkout.create.mockResolvedValue(placedCheckout());
    const result = await service.confirm(requestId, idempotencyKey, {
      addressId: 'address-1',
      deliveryDate: addDays(lagosToday(), 2),
      expectedTotal: 4500,
    });
    expect(result.id).toBe('checkout-1');
    expect(checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourcingRequestId: requestId }),
      }),
    );
    expect(cartItem.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ title: 'Supply confirmed' }),
    );
  });

  it('replays a confirm that already belongs to this request', async () => {
    checkout.findUnique.mockResolvedValue(placedCheckout());
    const result = await service.confirm(requestId, idempotencyKey, {
      addressId: 'address-1',
      deliveryDate: addDays(lagosToday(), 2),
      expectedTotal: 4500,
    });
    expect(result.checkoutNumber).toBe('CHK-000001');
    expect(produce.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key that belongs to another checkout', async () => {
    checkout.findUnique.mockResolvedValue({
      ...placedCheckout(),
      sourcingRequestId: 'other-request',
    });
    await expect(
      service.confirm(requestId, idempotencyKey, {
        addressId: 'address-1',
        deliveryDate: addDays(lagosToday(), 2),
        expectedTotal: 4500,
      }),
    ).rejects.toThrow('Idempotency-Key already belongs to another checkout');
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
        return requestRow({ status: SourcingRequestStatus.AWAITING_BUYER });
      },
    );
    checkout.findFirst.mockResolvedValue({
      id: 'checkout-1',
      status: CheckoutStatus.AWAITING_PAYMENT,
    });
    checkout.update.mockResolvedValue(placedCheckout());
    await service.close(requestId, { reason: 'Buyer withdrew' });
    expect(order.findMany).toHaveBeenCalled();
    expect(checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CheckoutStatus.CANCELLED }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        title: 'Request closed',
        summary: 'Buyer withdrew. Unpaid checkout released',
      }),
    );
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
    await service.escalate(requestId);
    expect(audit.record).not.toHaveBeenCalled();
    expect(sourcingRequest.update).not.toHaveBeenCalled();
  });
});
