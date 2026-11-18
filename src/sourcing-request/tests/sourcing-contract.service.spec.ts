import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AuditActorType,
  AuditCategory,
  CheckoutStatus,
  FarmVerificationStatus,
  NotificationType,
  Prisma,
  ProduceStatus,
  ProduceType,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type Agent,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { addDays, lagosToday, toDateColumn } from '../../common/dates';
import { LocationService } from '../../location/location.service';
import { NotificationService } from '../../notifications/notification.service';
import { CheckoutConfig } from '../../payment/checkout-config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmSourcingDto } from '../dto';
import { SourcingConfig } from '../sourcing-config';
import { SourcingContractService } from '../sourcing-contract.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const stateId = '22222222-2222-4222-8222-222222222222';
const lgaId = '33333333-3333-4333-8333-333333333333';
const agent = { id: 'agent-1', userId: 'agent-user-1' } as Agent;
const asAgent = { role: 'AGENT', userId: 'agent-user-1' } as const;
const asBuyer = { role: 'BUYER', userId: 'buyer-user-1' } as const;
const key = '44444444-4444-4444-8444-444444444444';
const from = addDays(lagosToday(), 2);
const to = addDays(lagosToday(), 5);

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    requestNumber: 'REQ-000001',
    buyerId: 'buyer-1',
    buyer: {
      userId: 'buyer-user-1',
      buyerId: 'BY-000001',
      user: { firstName: 'Ada', lastName: 'Buyer' },
    },
    assignedAgentId: 'agent-1',
    assignedAgent: {
      id: 'agent-1',
      userId: 'agent-user-1',
      agentId: 'AG-000001',
      user: { firstName: 'Musa', lastName: 'Agent' },
    },
    produceName: 'White maize',
    quantity: 10,
    unit: 'BAGS',
    status: SourcingRequestStatus.NEGOTIATING,
    agreedPrice: null,
    deliveryCountry: null,
    deliveryAddress: null,
    deliveryRegion: null,
    deliveryStateId: null,
    deliveryLgaId: null,
    deliveryState: null,
    deliveryLga: null,
    deliveryContactName: null,
    deliveryContactPhone: null,
    deliveryFrom: null,
    deliveryTo: null,
    ...overrides,
  };
}

const confirmedRow = (overrides: Record<string, unknown> = {}) =>
  requestRow({
    status: SourcingRequestStatus.CONFIRMED,
    agreedPrice: new Prisma.Decimal('12420.00'),
    deliveryCountry: 'Nigeria',
    deliveryAddress: '12 Bompai Road',
    deliveryRegion: 'North West',
    deliveryStateId: stateId,
    deliveryLgaId: lgaId,
    deliveryState: { name: 'Kano' },
    deliveryLga: { name: 'Nassarawa' },
    deliveryContactName: 'Ada',
    deliveryContactPhone: '+2348012345678',
    deliveryFrom: toDateColumn(from),
    deliveryTo: toDateColumn(to),
    ...overrides,
  });

function farm(id: string, farmCode: string, verified = true) {
  return {
    id,
    farmCode,
    verificationStatus: verified
      ? FarmVerificationStatus.VERIFIED
      : FarmVerificationStatus.PENDING,
    owner: {
      userId: `farmer-user-${id}`,
      user: { firstName: 'Bala', lastName: farmCode },
    },
  };
}

function acceptedOffer(
  id: string,
  farmId: string,
  farmCode: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    farmId,
    produceId: null,
    quantity: 4,
    unit: SourcingUnit.BAGS,
    status: SourcingOfferStatus.ACCEPTED,
    agreedUnitPrice: new Prisma.Decimal('1200'),
    farm: farm(farmId, farmCode),
    ...overrides,
  };
}

function acceptedRows() {
  return [
    acceptedOffer('offer-a', 'farm-a', 'LF-000001'),
    acceptedOffer('offer-b', 'farm-b', 'LF-000002', {
      quantity: 6,
      agreedUnitPrice: new Prisma.Decimal('1000'),
    }),
  ];
}

// 4×1200 + 6×1000 = 10800; 5% service = 540; 10% commission = 480 + 600.
const SUGGESTED = '12420.00';

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    sourcingRequestId: requestId,
    terms: { requestNumber: 'REQ-000001' },
    agreedPrice: new Prisma.Decimal(SUGGESTED),
    buyerSignedAt: null,
    agentSignedAt: null,
    voidedAt: null,
    createdAt: new Date('2026-11-18T08:00:00.000Z'),
    ...overrides,
  };
}

function confirmDto(overrides: Record<string, unknown> = {}) {
  return {
    agreedPrice: SUGGESTED,
    deliveryCountry: 'Nigeria',
    deliveryAddress: '12 Bompai Road',
    deliveryRegion: 'North West',
    deliveryStateId: stateId,
    deliveryLgaId: lgaId,
    deliveryContactName: 'Ada',
    deliveryContactPhone: '+2348012345678',
    deliveryFrom: from,
    deliveryTo: to,
    ...overrides,
  };
}

async function errorsFor(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(ConfirmSourcingDto, body));
  return errors.map((error) => error.property);
}

describe('ConfirmSourcingDto', () => {
  it('accepts a Nigerian delivery with state and LGA', async () => {
    await expect(errorsFor(confirmDto())).resolves.toEqual([]);
  });

  it('matches Nigeria case-insensitively', async () => {
    await expect(
      errorsFor(confirmDto({ deliveryCountry: 'NIGERIA' })),
    ).resolves.toEqual([]);
  });

  it.each([' nigeria ', 'NIGERIA', 'Nigeria'])(
    'stores %p as "Nigeria"',
    (deliveryCountry) => {
      const dto = plainToInstance(
        ConfirmSourcingDto,
        confirmDto({ deliveryCountry }),
      );
      expect(dto.deliveryCountry).toBe('Nigeria');
    },
  );

  it('keeps any other country as typed, trimmed', () => {
    const dto = plainToInstance(
      ConfirmSourcingDto,
      confirmDto({ deliveryCountry: ' Ghana ' }),
    );
    expect(dto.deliveryCountry).toBe('Ghana');
  });

  it('needs a state and LGA for Nigeria', async () => {
    await expect(
      errorsFor(
        confirmDto({ deliveryStateId: undefined, deliveryLgaId: undefined }),
      ),
    ).resolves.toEqual(['deliveryStateId', 'deliveryLgaId']);
  });

  it('refuses a state or LGA outside Nigeria', async () => {
    await expect(
      errorsFor(
        confirmDto({ deliveryCountry: 'Ghana', deliveryLgaId: undefined }),
      ),
    ).resolves.toEqual(['deliveryStateId']);
    await expect(
      errorsFor(
        confirmDto({
          deliveryCountry: 'Ghana',
          deliveryStateId: undefined,
          deliveryLgaId: undefined,
        }),
      ),
    ).resolves.toEqual([]);
  });

  it.each(['12420.001', '-1', '0', 'abc'])(
    'refuses agreedPrice %s',
    async (agreedPrice) => {
      await expect(errorsFor(confirmDto({ agreedPrice }))).resolves.toEqual([
        'agreedPrice',
      ]);
    },
  );

  it('refuses a date that is not YYYY-MM-DD', async () => {
    await expect(
      errorsFor(confirmDto({ deliveryTo: '2026-02-30' })),
    ).resolves.toEqual(['deliveryTo']);
  });
});

describe('SourcingContractService', () => {
  const sourcingRequest = { findUnique: jest.fn(), update: jest.fn() };
  const sourcingAllocation = {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const sourcingContract = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const produce = {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const checkout = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  };
  const state = { findUniqueOrThrow: jest.fn() };
  const auditEvent = { createMany: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    sourcingRequest,
    sourcingAllocation,
    sourcingContract,
    produce,
    checkout,
    state,
    auditEvent,
  };
  const database = {
    ...tx,
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const notifications = { notify: jest.fn(), dispatch: jest.fn() };
  const audit = { record: jest.fn() };
  const locations = { requireLga: jest.fn() };
  const service = new SourcingContractService(
    database as unknown as PrismaService,
    {
      serviceFeePercent: new Prisma.Decimal(5),
      agentCommissionPercent: new Prisma.Decimal(10),
      deliveryFee: new Prisma.Decimal(3500),
      holdMinutes: 30,
    } as CheckoutConfig,
    { checkoutHoldHours: 48 } as SourcingConfig,
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
    locations as unknown as LocationService,
  );

  // The raw SQL each call sent, so savepoint use can be asserted.
  const rawSql = () =>
    tx.$executeRaw.mock.calls.map((call: unknown[]) =>
      (call[0] as TemplateStringsArray).join('?'),
    );

  beforeEach(() => {
    jest.resetAllMocks();
    notifications.notify.mockResolvedValue(['delivery-1']);
    sourcingContract.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(contractRow(data)),
    );
    sourcingContract.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(contractRow(data)),
    );
    locations.requireLga.mockResolvedValue({
      id: lgaId,
      stateId,
      name: 'Nassarawa',
    });
    state.findUniqueOrThrow.mockResolvedValue({ id: stateId, name: 'Kano' });
  });

  describe('confirm', () => {
    beforeEach(() => {
      sourcingRequest.findUnique.mockResolvedValue(requestRow());
      sourcingAllocation.findMany.mockResolvedValue(acceptedRows());
    });

    it('stores the terms, snapshots a contract and moves to CONFIRMED', async () => {
      const contract = await service.confirm(
        agent,
        requestId,
        plainToInstance(ConfirmSourcingDto, confirmDto()),
      );

      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          agreedPrice: new Prisma.Decimal(SUGGESTED),
          deliveryCountry: 'Nigeria',
          deliveryAddress: '12 Bompai Road',
          deliveryRegion: 'North West',
          deliveryStateId: stateId,
          deliveryLgaId: lgaId,
          deliveryContactName: 'Ada',
          deliveryContactPhone: '+2348012345678',
          deliveryFrom: toDateColumn(from),
          deliveryTo: toDateColumn(to),
        },
      });
      expect(locations.requireLga).toHaveBeenCalledWith(stateId, lgaId, tx);
      expect(sourcingContract.create).toHaveBeenCalledWith({
        data: {
          sourcingRequestId: requestId,
          agreedPrice: new Prisma.Decimal(SUGGESTED),
          terms: {
            requestNumber: 'REQ-000001',
            buyer: { name: 'Ada Buyer', code: 'BY-000001' },
            agent: { name: 'Musa Agent', code: 'AG-000001' },
            produceName: 'White maize',
            quantity: 10,
            unit: 'BAGS',
            agreedPrice: SUGGESTED,
            delivery: {
              country: 'Nigeria',
              address: '12 Bompai Road',
              region: 'North West',
              state: 'Kano',
              lga: 'Nassarawa',
              contactName: 'Ada',
              contactPhone: '+2348012345678',
              from,
              to,
            },
            lines: [
              {
                farmCode: 'LF-000001',
                farmerName: 'Bala LF-000001',
                produceName: 'White maize',
                quantity: 4,
                unit: SourcingUnit.BAGS,
                agreedUnitPrice: '1200.00',
              },
              {
                farmCode: 'LF-000002',
                farmerName: 'Bala LF-000002',
                produceName: 'White maize',
                quantity: 6,
                unit: SourcingUnit.BAGS,
                agreedUnitPrice: '1000.00',
              },
            ],
          },
        },
      });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.CONFIRMED },
      });
      expect(contract).toMatchObject({
        id: 'contract-1',
        agreedPrice: SUGGESTED,
        buyerSignedAt: null,
        agentSignedAt: null,
        checkoutId: null,
      });
    });

    it('locks the request, audits and tells the buyer the contract is ready', async () => {
      await service.confirm(
        agent,
        requestId,
        plainToInstance(ConfirmSourcingDto, confirmDto()),
      );
      expect(rawSql()[0]).toContain('pg_advisory_xact_lock');
      expect(tx.$executeRaw.mock.calls[0]).toContain(`sourcing:${requestId}`);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.EXTENSION_AGENT,
          actorUserId: 'agent-user-1',
          agentId: 'agent-1',
          category: AuditCategory.SOURCING,
          title: 'Contract issued',
          sourcingRequestId: requestId,
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['buyer-user-1'],
          type: NotificationType.SOURCING_CONTRACT_READY,
          params: { requestId, requestNumber: 'REQ-000001' },
        },
        tx,
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('needs no state or LGA outside Nigeria', async () => {
      await service.confirm(
        agent,
        requestId,
        plainToInstance(
          ConfirmSourcingDto,
          confirmDto({
            deliveryCountry: 'Ghana',
            deliveryStateId: undefined,
            deliveryLgaId: undefined,
          }),
        ),
      );
      expect(locations.requireLga).not.toHaveBeenCalled();
      expect(sourcingContract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          terms: expect.objectContaining({
            delivery: expect.objectContaining({
              country: 'Ghana',
              state: null,
              lga: null,
            }),
          }),
        }),
      });
    });

    it('409s a price one kobo below the floor and writes nothing', async () => {
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(
            ConfirmSourcingDto,
            confirmDto({ agreedPrice: '12419.99' }),
          ),
        ),
      ).rejects.toMatchObject({
        response: { code: 'SOURCING_PRICE_BELOW_FLOOR' },
      });
      expect(sourcingContract.create).not.toHaveBeenCalled();
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it('400s an LGA outside the state', async () => {
      locations.requireLga.mockRejectedValue(
        new BadRequestException('Invalid state or LGA'),
      );
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(ConfirmSourcingDto, confirmDto()),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sourcingContract.create).not.toHaveBeenCalled();
    });

    it('400s a window that ends before it starts', async () => {
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(
            ConfirmSourcingDto,
            confirmDto({ deliveryFrom: to, deliveryTo: from }),
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sourcingContract.create).not.toHaveBeenCalled();
    });

    it('400s a window that starts in the past', async () => {
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(
            ConfirmSourcingDto,
            confirmDto({ deliveryFrom: addDays(lagosToday(), -1) }),
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks no listing stock', async () => {
      await service.confirm(
        agent,
        requestId,
        plainToInstance(ConfirmSourcingDto, confirmDto()),
      );
      expect(produce.findUnique).not.toHaveBeenCalled();
      expect(produce.updateMany).not.toHaveBeenCalled();
      expect(produce.create).not.toHaveBeenCalled();
    });

    it('409s SOURCING_FARM_UNVERIFIED when an accepted farm lost its verification, changing nothing', async () => {
      sourcingAllocation.findMany.mockResolvedValue([
        acceptedRows()[0],
        acceptedOffer('offer-b', 'farm-b', 'LF-000002', {
          quantity: 6,
          agreedUnitPrice: new Prisma.Decimal('1000'),
          farm: farm('farm-b', 'LF-000002', false),
        }),
      ]);
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(ConfirmSourcingDto, confirmDto()),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SOURCING_FARM_UNVERIFIED' },
      });
      expect(sourcingRequest.update).not.toHaveBeenCalled();
      expect(sourcingContract.create).not.toHaveBeenCalled();
    });

    it('409s SOURCING_NOT_COVERED when accepted offers no longer cover the request', async () => {
      sourcingAllocation.findMany.mockResolvedValue(acceptedRows().slice(1));
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(ConfirmSourcingDto, confirmDto()),
        ),
      ).rejects.toMatchObject({ response: { code: 'SOURCING_NOT_COVERED' } });
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it('asks only for accepted offers, in a stable order', async () => {
      await service.confirm(
        agent,
        requestId,
        plainToInstance(ConfirmSourcingDto, confirmDto()),
      );
      expect(sourcingAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sourcingRequestId: requestId,
            status: SourcingOfferStatus.ACCEPTED,
          },
          orderBy: { id: 'asc' },
        }),
      );
    });

    it('409s unless NEGOTIATING', async () => {
      sourcingRequest.findUnique.mockResolvedValue(
        requestRow({ status: SourcingRequestStatus.FINDING_SUPPLY }),
      );
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(ConfirmSourcingDto, confirmDto()),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sourcingContract.create).not.toHaveBeenCalled();
    });

    it("404s on another agent's request", async () => {
      sourcingRequest.findUnique.mockResolvedValue(
        requestRow({
          assignedAgentId: 'agent-2',
          assignedAgent: {
            id: 'agent-2',
            userId: 'agent-user-2',
            agentId: 'AG-000002',
            user: { firstName: 'Other', lastName: 'Agent' },
          },
        }),
      );
      await expect(
        service.confirm(
          agent,
          requestId,
          plainToInstance(ConfirmSourcingDto, confirmDto()),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sign', () => {
    const checkoutRow = {
      id: 'checkout-1',
      checkoutNumber: 'CHK-000001',
      totalPrice: new Prisma.Decimal(SUGGESTED),
      orders: [
        { id: 'order-1', orderNumber: 'ORD-1', farmId: 'farm-a' },
        { id: 'order-2', orderNumber: 'ORD-2', farmId: 'farm-b' },
      ],
    };

    beforeEach(() => {
      sourcingRequest.findUnique.mockResolvedValue(confirmedRow());
      sourcingAllocation.findMany.mockResolvedValue(acceptedRows());
      checkout.findUnique.mockResolvedValue(null);
      checkout.create.mockResolvedValue(checkoutRow);
      produce.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: `listing-${String(data.farmId)}`, ...data }),
      );
    });

    it('records the first signature without a checkout', async () => {
      sourcingContract.findFirst.mockResolvedValue(contractRow());

      const contract = await service.sign(requestId, asBuyer, key);

      expect(sourcingContract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { buyerSignedAt: expect.any(Date) },
      });
      expect(produce.create).not.toHaveBeenCalled();
      expect(checkout.create).not.toHaveBeenCalled();
      expect(contract.buyerSignedAt).toEqual(expect.any(Date));
      expect(contract.checkoutId).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.BUYER,
          actorUserId: 'buyer-user-1',
          // AuditEvent_actor_check: only an agent actor carries agentId.
          agentId: null,
          title: 'Contract signed',
          sourcingRequestId: requestId,
        }),
      );
      expect(rawSql()[0]).toContain('pg_advisory_xact_lock');
    });

    it('on the second signature, places the checkout at the agreed prices', async () => {
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ buyerSignedAt: new Date() }),
      );

      const contract = await service.sign(requestId, asAgent, key);

      // Nothing is reserved: the hidden listings are born already held.
      expect(produce.updateMany).not.toHaveBeenCalled();
      expect(produce.findUnique).not.toHaveBeenCalled();
      expect(checkout.create).toHaveBeenCalledTimes(1);
      const { data } = checkout.create.mock.calls[0][0];
      expect(data).toMatchObject({
        buyerId: 'buyer-1',
        idempotencyKey: key,
        status: CheckoutStatus.AWAITING_PAYMENT,
        sourcingRequestId: requestId,
        subtotal: new Prisma.Decimal('10800'),
        deliveryFee: new Prisma.Decimal(0),
        serviceFee: new Prisma.Decimal('540'),
        agentCommission: new Prisma.Decimal('1080'),
        totalPrice: new Prisma.Decimal(SUGGESTED),
        deliveryLabel: 'Sourcing delivery',
        deliveryStreet: '12 Bompai Road',
        deliveryState: 'Kano',
        deliveryLga: 'Nassarawa',
        deliveryCountry: 'Nigeria',
        deliveryDate: toDateColumn(from),
        deliveryDateTo: toDateColumn(to),
        deliveryContactName: 'Ada',
        deliveryContactPhone: '+2348012345678',
      });
      expect(data.orders.create).toEqual([
        expect.objectContaining({
          produceId: 'listing-farm-a',
          farmId: 'farm-a',
          produceName: 'White maize',
          quantity: 4,
          totalPrice: new Prisma.Decimal('4800'),
          agentCommission: new Prisma.Decimal('480'),
          commissionAgentId: 'agent-1',
          sourced: true,
        }),
        expect.objectContaining({
          produceId: 'listing-farm-b',
          farmId: 'farm-b',
          quantity: 6,
          totalPrice: new Prisma.Decimal('6000'),
          agentCommission: new Prisma.Decimal('600'),
          commissionAgentId: 'agent-1',
          sourced: true,
        }),
      ]);
      // The sourcing hold, not the cart's 30 minutes.
      const holdMs =
        (data.expiresAt as Date).getTime() - contract.agentSignedAt!.getTime();
      expect(Math.round(holdMs / 3_600_000)).toBe(48);
      expect(sourcingContract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { agentSignedAt: expect.any(Date) },
      });
      expect(contract.checkoutId).toBe('checkout-1');
      // The orders are placed by the system: an agent actor would need an
      // agentId on each order row (AuditEvent_actor_check). The signature's
      // own audit row names who signed.
      expect(auditEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            actorType: AuditActorType.SYSTEM,
            actorUserId: null,
            sourcingRequestId: requestId,
          }),
          expect.objectContaining({ actorType: AuditActorType.SYSTEM }),
        ],
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['buyer-user-1'],
          type: NotificationType.SOURCING_PAYMENT_READY,
          params: {
            requestId,
            requestNumber: 'REQ-000001',
            checkoutId: 'checkout-1',
            amount: SUGGESTED,
          },
        },
        tx,
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
      expect(rawSql().some((sql) => sql.includes('SAVEPOINT'))).toBe(false);
    });

    it('creates one hidden SOURCED listing per accepted offer, already held by its order', async () => {
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ buyerSignedAt: new Date() }),
      );

      await service.sign(requestId, asAgent, key);

      expect(produce.create.mock.calls.map(([arg]) => arg as unknown)).toEqual([
        {
          data: {
            farmId: 'farm-a',
            name: 'White maize',
            unit: 'bags',
            quantity: 4,
            actualQuantity: 4,
            floatingQuantity: 0,
            pricePerUnit: new Prisma.Decimal('1200'),
            status: ProduceStatus.SOURCED,
            type: ProduceType.LOCAL,
          },
        },
        {
          data: {
            farmId: 'farm-b',
            name: 'White maize',
            unit: 'bags',
            quantity: 6,
            actualQuantity: 6,
            floatingQuantity: 0,
            pricePerUnit: new Prisma.Decimal('1000'),
            status: ProduceStatus.SOURCED,
            type: ProduceType.LOCAL,
          },
        },
      ]);
      expect(sourcingAllocation.update).toHaveBeenCalledWith({
        where: { id: 'offer-a' },
        data: { produceId: 'listing-farm-a' },
      });
      expect(sourcingAllocation.update).toHaveBeenCalledWith({
        where: { id: 'offer-b' },
        data: { produceId: 'listing-farm-b' },
      });
    });

    it("uses each offer's own unit and price for its listing and order line", async () => {
      // 20 t as 8000 kg at N250/kg and 12 t at N240,000/t: subtotal 4,880,000,
      // 5% service 244,000, 10% commission 488,000.
      sourcingRequest.findUnique.mockResolvedValue(
        confirmedRow({ quantity: 20, unit: SourcingUnit.TONNES }),
      );
      sourcingAllocation.findMany.mockResolvedValue([
        acceptedOffer('offer-a', 'farm-a', 'LF-000001', {
          quantity: 8000,
          unit: SourcingUnit.KG,
          agreedUnitPrice: new Prisma.Decimal('250'),
        }),
        acceptedOffer('offer-b', 'farm-b', 'LF-000002', {
          quantity: 12,
          unit: SourcingUnit.TONNES,
          agreedUnitPrice: new Prisma.Decimal('240000'),
        }),
      ]);
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({
          buyerSignedAt: new Date(),
          agreedPrice: new Prisma.Decimal('5612000.00'),
        }),
      );
      checkout.create.mockResolvedValue({
        ...checkoutRow,
        totalPrice: new Prisma.Decimal('5612000.00'),
      });

      await service.sign(requestId, asAgent, key);

      expect(
        produce.create.mock.calls.map(
          ([arg]: [{ data: { unit: string; quantity: number } }]) => [
            arg.data.unit,
            arg.data.quantity,
          ],
        ),
      ).toEqual([
        ['kg', 8000],
        ['tonnes', 12],
      ]);
      const { data } = checkout.create.mock.calls[0][0];
      expect(data.subtotal).toEqual(new Prisma.Decimal('4880000'));
      expect(
        data.orders.create.map(
          (order: { quantity: number; totalPrice: Prisma.Decimal }) => [
            order.quantity,
            order.totalPrice.toFixed(2),
          ],
        ),
      ).toEqual([
        [8000, '2000000.00'],
        [12, '2880000.00'],
      ]);
    });

    it('puts an agreed price above the floor into the service fee only', async () => {
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({
          buyerSignedAt: new Date(),
          agentSignedAt: null,
          agreedPrice: new Prisma.Decimal('13000.00'),
        }),
      );

      await service.sign(requestId, asAgent, key);

      const { data } = checkout.create.mock.calls[0][0];
      // 13000 − 10800 subtotal − 1080 commission; 580 above the 540 floor fee.
      expect(data).toMatchObject({
        subtotal: new Prisma.Decimal('10800'),
        deliveryFee: new Prisma.Decimal(0),
        serviceFee: new Prisma.Decimal('1120'),
        agentCommission: new Prisma.Decimal('1080'),
        totalPrice: new Prisma.Decimal('13000'),
      });
      expect(
        data.orders.create.map(
          (order: {
            totalPrice: Prisma.Decimal;
            agentCommission: Prisma.Decimal;
          }) => [order.totalPrice.toFixed(2), order.agentCommission.toFixed(2)],
        ),
      ).toEqual([
        ['4800.00', '480.00'],
        ['6000.00', '600.00'],
      ]);
    });

    it('is a no-op when the same party signs again', async () => {
      const signedAt = new Date('2026-11-18T09:00:00.000Z');
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ buyerSignedAt: signedAt }),
      );

      const contract = await service.sign(requestId, asBuyer, key);

      expect(contract.buyerSignedAt).toBe(signedAt);
      expect(sourcingContract.update).not.toHaveBeenCalled();
      expect(produce.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('replays the checkout for a repeated Idempotency-Key', async () => {
      checkout.findUnique.mockResolvedValue({
        ...checkoutRow,
        sourcingRequestId: requestId,
        // Placed when this contract was fully signed.
        createdAt: new Date('2026-11-18T09:00:00.000Z'),
      });
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ buyerSignedAt: new Date(), agentSignedAt: new Date() }),
      );

      const contract = await service.sign(requestId, asAgent, key);

      expect(contract.checkoutId).toBe('checkout-1');
      expect(checkout.create).not.toHaveBeenCalled();
      expect(sourcingContract.update).not.toHaveBeenCalled();
    });

    it('409s a key whose checkout predates the current contract', async () => {
      // The old checkout expired, the request went back to negotiation and a
      // new contract was issued: replaying would skip this signature.
      checkout.findUnique.mockResolvedValue({
        ...checkoutRow,
        sourcingRequestId: requestId,
        createdAt: new Date('2026-11-17T09:00:00.000Z'),
      });
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ agentSignedAt: new Date() }),
      );

      await expect(service.sign(requestId, asBuyer, key)).rejects.toMatchObject(
        {
          status: 409,
          response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
        },
      );
      expect(sourcingContract.update).not.toHaveBeenCalled();
      expect(checkout.create).not.toHaveBeenCalled();
    });

    it("409s a key that belongs to another request's checkout", async () => {
      checkout.findUnique.mockResolvedValue({
        ...checkoutRow,
        sourcingRequestId: null,
      });
      await expect(
        service.sign(requestId, asAgent, key),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s unless CONFIRMED', async () => {
      sourcingRequest.findUnique.mockResolvedValue(
        confirmedRow({ status: SourcingRequestStatus.NEGOTIATING }),
      );
      await expect(
        service.sign(requestId, asBuyer, key),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("404s on another buyer's request", async () => {
      await expect(
        service.sign(requestId, { role: 'BUYER', userId: 'buyer-user-2' }, key),
      ).rejects.toBeInstanceOf(NotFoundException);
      // An agent's user id does not make them the buyer.
      await expect(
        service.sign(requestId, { role: 'BUYER', userId: 'agent-user-1' }, key),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns the latest contract with its checkout once fully signed', async () => {
      sourcingRequest.findUnique.mockResolvedValue(confirmedRow());
      sourcingContract.findFirst.mockResolvedValue(
        contractRow({ buyerSignedAt: new Date(), agentSignedAt: new Date() }),
      );
      checkout.findFirst.mockResolvedValue({ id: 'checkout-1' });

      const contract = await service.findOne(requestId, asBuyer);

      expect(contract.checkoutId).toBe('checkout-1');
      expect(checkout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sourcingRequestId: requestId,
            createdAt: { gte: contractRow().createdAt },
          },
        }),
      );
    });

    it('404s when no contract exists yet', async () => {
      sourcingRequest.findUnique.mockResolvedValue(requestRow());
      sourcingContract.findFirst.mockResolvedValue(null);
      await expect(service.findOne(requestId, asAgent)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
