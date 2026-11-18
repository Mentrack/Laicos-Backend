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
  AuditResource,
  FarmVerificationStatus,
  NotificationType,
  Prisma,
  ProduceStatus,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type Agent,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { NotificationService } from '../../notifications/notification.service';
import { CheckoutConfig } from '../../payment/checkout-config';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentSourcingRequestService } from '../agent-sourcing-request.service';
import {
  DeclineSourcingRequestDto,
  PriceSourcingOfferDto,
  SetSourcingOffersDto,
} from '../dto';
import { SourcingConfig } from '../sourcing-config';

const requestId = '11111111-1111-4111-8111-111111111111';
const agent = { id: 'agent-1', userId: 'agent-user-1' } as Agent;
const assignedAt = new Date('2026-11-18T08:00:00.000Z');

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    requestNumber: 'REQ-000001',
    buyerId: 'buyer-1',
    buyer: { userId: 'buyer-user-1' },
    produceName: 'White maize',
    quantity: 10,
    unit: 'BAGS',
    quality: 'GRADE_A',
    packaging: 'BAGS',
    condition: 'FRESH',
    additionalSpecs: null,
    deliveryDestination: 'Kano',
    requiredDate: new Date('2026-12-01T00:00:00.000Z'),
    timeline: null,
    logisticsNotes: null,
    status: SourcingRequestStatus.ASSIGNED,
    assignedAgentId: agent.id,
    assignedAt,
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    allocations: [],
    contracts: [],
    ...overrides,
  };
}

describe('AgentSourcingRequestService', () => {
  const sourcingRequest = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const sourcingDecline = { create: jest.fn() };
  const conversation = { upsert: jest.fn() };
  const farm = { findMany: jest.fn(), count: jest.fn() };
  // Sourcing never reads or moves listing stock; the spy proves it.
  const produce = { findMany: jest.fn(), updateMany: jest.fn() };
  const sourcingAllocation = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  const sourcingContract = { findFirst: jest.fn(), updateMany: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    sourcingRequest,
    sourcingDecline,
    conversation,
    farm,
    produce,
    sourcingAllocation,
    sourcingContract,
  };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const notifications = { notify: jest.fn(), dispatch: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new AgentSourcingRequestService(
    database as unknown as PrismaService,
    { responseHours: 24 } as SourcingConfig,
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
    {
      serviceFeePercent: new Prisma.Decimal(5),
      agentCommissionPercent: new Prisma.Decimal(10),
    } as CheckoutConfig,
  );

  // moveSourcingStatus and requireOwn both read the request under the lock.
  const withRequest = (overrides: Record<string, unknown> = {}) => {
    sourcingRequest.findUnique.mockResolvedValue(requestRow(overrides));
    sourcingRequest.findFirst.mockResolvedValue(
      requestRow({ status: SourcingRequestStatus.FINDING_SUPPLY }),
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    notifications.notify.mockResolvedValue(['delivery-1']);
  });

  describe('read', () => {
    it('lists only my own requests, with respondBy, offers and the latest contract', async () => {
      sourcingRequest.findMany.mockResolvedValue([
        requestRow({
          allocations: [
            {
              id: 'offer-1',
              farmId: 'farm-1',
              produceId: null,
              quantity: 4,
              unit: SourcingUnit.BAGS,
              status: SourcingOfferStatus.OFFERED,
              agreedUnitPrice: new Prisma.Decimal('1200'),
              farm: { farmCode: 'LF-000001', name: 'Green Farm' },
            },
          ],
          contracts: [
            {
              id: 'contract-1',
              terms: { a: 1 },
              agreedPrice: new Prisma.Decimal('4800'),
              buyerSignedAt: null,
              agentSignedAt: null,
              voidedAt: null,
              createdAt: assignedAt,
            },
          ],
        }),
      ]);
      sourcingRequest.count.mockResolvedValue(1);

      const { data, metaData } = await service.findAll(agent, {});

      expect(sourcingRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { assignedAgentId: agent.id } }),
      );
      expect(metaData.total).toBe(1);
      expect(data[0].respondBy).toEqual(new Date('2026-11-19T08:00:00.000Z'));
      expect(data[0].offers).toEqual([
        {
          id: 'offer-1',
          farmId: 'farm-1',
          farmCode: 'LF-000001',
          farmName: 'Green Farm',
          quantity: 4,
          unit: SourcingUnit.BAGS,
          status: SourcingOfferStatus.OFFERED,
          agreedUnitPrice: '1200.00',
        },
      ]);
      expect(data[0].contract).toMatchObject({
        id: 'contract-1',
        agreedPrice: '4800.00',
      });
    });

    it('has no respondBy once the request is answered', async () => {
      sourcingRequest.findFirst.mockResolvedValue(
        requestRow({ status: SourcingRequestStatus.FINDING_SUPPLY }),
      );
      const detail = await service.findOne(agent, requestId);
      expect(detail.conversationId).toBeNull();
      expect(detail.respondBy).toBeNull();
      expect(detail.contract).toBeNull();
    });

    it("404s on another agent's request", async () => {
      sourcingRequest.findFirst.mockResolvedValue(null);
      await expect(service.findOne(agent, requestId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(sourcingRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: requestId, assignedAgentId: agent.id },
        }),
      );
    });
  });

  describe('accept', () => {
    it('moves to FINDING_SUPPLY and opens the conversation once', async () => {
      withRequest();
      await service.accept(agent, requestId);
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.FINDING_SUPPLY },
      });
      expect(conversation.upsert).toHaveBeenCalledTimes(1);
      expect(conversation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourcingRequestId: requestId },
          create: {
            sourcingRequestId: requestId,
            buyerId: 'buyer-1',
            agentUserId: 'agent-user-1',
          },
        }),
      );
    });

    it('audits the acceptance', async () => {
      withRequest();
      await service.accept(agent, requestId);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.EXTENSION_AGENT,
          actorUserId: 'agent-user-1',
          agentId: 'agent-1',
          category: AuditCategory.SOURCING,
          title: 'Request accepted',
          resource: AuditResource.SOURCING_REQUEST,
          resourceId: requestId,
          sourcingRequestId: requestId,
        }),
      );
    });

    it('returns the chat id', async () => {
      withRequest();
      sourcingRequest.findFirst.mockResolvedValue(
        requestRow({
          status: SourcingRequestStatus.FINDING_SUPPLY,
          conversation: { id: 'conversation-1' },
        }),
      );
      const detail = await service.accept(agent, requestId);
      expect(detail.conversationId).toBe('conversation-1');
    });

    it("404s on another agent's request", async () => {
      withRequest({ assignedAgentId: 'someone-else' });
      await expect(service.accept(agent, requestId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(sourcingRequest.update).not.toHaveBeenCalled();
      expect(conversation.upsert).not.toHaveBeenCalled();
    });

    it.each([
      SourcingRequestStatus.PENDING,
      SourcingRequestStatus.FINDING_SUPPLY,
    ])('409s from %s', async (status) => {
      withRequest({ status });
      await expect(service.accept(agent, requestId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(conversation.upsert).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    it('records the reason, clears the agent and notifies the buyer', async () => {
      withRequest();
      await service.decline(agent, requestId, { reason: 'Too far away' });

      expect(sourcingDecline.create).toHaveBeenCalledWith({
        data: {
          sourcingRequestId: requestId,
          agentId: agent.id,
          reason: 'Too far away',
        },
      });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.PENDING },
      });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { assignedAgentId: null, assignedAt: null },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['buyer-user-1'],
          type: NotificationType.SOURCING_UNANSWERED,
          params: { requestId, requestNumber: 'REQ-000001', responseHours: 24 },
        },
        tx,
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('audits the decline with the reason', async () => {
      withRequest();
      await service.decline(agent, requestId, { reason: 'Too far away' });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.EXTENSION_AGENT,
          actorUserId: 'agent-user-1',
          agentId: 'agent-1',
          category: AuditCategory.SOURCING,
          title: 'Request declined',
          summary: 'Too far away',
          sourcingRequestId: requestId,
        }),
      );
    });

    it("404s on another agent's request", async () => {
      withRequest({ assignedAgentId: 'someone-else' });
      await expect(
        service.decline(agent, requestId, { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sourcingDecline.create).not.toHaveBeenCalled();
    });

    it('409s once the request is accepted', async () => {
      withRequest({ status: SourcingRequestStatus.FINDING_SUPPLY });
      await expect(
        service.decline(agent, requestId, { reason: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.dispatch).not.toHaveBeenCalled();
    });
  });

  const finding = { status: SourcingRequestStatus.FINDING_SUPPLY };

  function farmRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'farm-1',
      farmCode: 'LF-000001',
      name: 'Green Farm',
      verificationStatus: FarmVerificationStatus.VERIFIED,
      owner: { userId: 'farmer-user-1' },
      ...overrides,
    };
  }

  function offer(overrides: Record<string, unknown> = {}) {
    return {
      id: 'offer-1',
      farmId: 'farm-1',
      produceId: null,
      quantity: 4,
      unit: SourcingUnit.BAGS,
      status: SourcingOfferStatus.OFFERED,
      agreedUnitPrice: null,
      farm: farmRow(),
      ...overrides,
    };
  }

  describe('farms', () => {
    beforeEach(() => {
      farm.findMany.mockResolvedValue([]);
      farm.count.mockResolvedValue(0);
    });

    const whereOf = () =>
      (farm.findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0]
        .where;
    const like = (value: string) => ({ contains: value, mode: 'insensitive' });
    // A SOURCED listing only backs a sourced order, so it never makes a farm
    // a match.
    const listingNamed = (value: string) => ({
      produce: {
        some: { status: { not: ProduceStatus.SOURCED }, name: like(value) },
      },
    });

    it('defaults to verified farms growing the crop or listing it, in the chosen state and LGA', async () => {
      withRequest(finding);
      await service.farms(agent, requestId, {
        stateId: 'state-1',
        lgaId: 'lga-1',
      });
      expect(whereOf()).toEqual({
        verificationStatus: FarmVerificationStatus.VERIFIED,
        stateId: 'state-1',
        lgaId: 'lga-1',
        OR: [{ mainProduce: like('White maize') }, listingNamed('White maize')],
      });
    });

    it('has no stock or listing-status filter beyond excluding SOURCED', async () => {
      withRequest(finding);
      await service.farms(agent, requestId, {});
      const where = JSON.stringify(whereOf());
      expect(where).not.toContain('floatingQuantity');
      expect(where).not.toContain(ProduceStatus.PUBLISHED);
    });

    it('lets a search replace the crop filter, matching farm, farmer, main produce and listing names', async () => {
      withRequest(finding);
      await service.farms(agent, requestId, {
        search: ' musa  LF-0 ',
        stateId: 'state-1',
      });
      const where = whereOf();
      expect(where).toMatchObject({
        verificationStatus: FarmVerificationStatus.VERIFIED,
        stateId: 'state-1',
      });
      expect(where).not.toHaveProperty('OR');
      expect(JSON.stringify(where)).not.toContain('White maize');
      const matches = (token: string) => ({
        OR: [
          { name: like(token) },
          { farmCode: like(token) },
          { owner: { farmerId: like(token) } },
          { owner: { user: { firstName: like(token) } } },
          { owner: { user: { lastName: like(token) } } },
          { mainProduce: like(token) },
          listingNamed(token),
        ],
      });
      expect(where.AND).toEqual([matches('musa'), matches('LF-0')]);
    });

    it("formats rows with the farmer, location, active listing names and this request's offer", async () => {
      withRequest(finding);
      farm.findMany.mockResolvedValue([
        {
          id: 'farm-1',
          farmCode: 'LF-000001',
          name: 'Green Farm',
          mainProduce: 'Maize',
          state: { name: 'Kano' },
          lga: { name: 'Dala' },
          owner: {
            farmerId: 'FRM-000001',
            user: { firstName: 'Musa', lastName: 'Ali' },
          },
          produce: [{ name: 'White maize' }, { name: 'White maize' }],
          sourcingAllocations: [{ id: 'offer-1' }],
        },
        {
          id: 'farm-2',
          farmCode: 'LF-000002',
          name: 'Dry Farm',
          mainProduce: 'White maize',
          state: { name: 'Kano' },
          lga: { name: 'Dala' },
          owner: {
            farmerId: 'FRM-000002',
            user: { firstName: 'Bala', lastName: 'Sani' },
          },
          produce: [],
          sourcingAllocations: [],
        },
      ]);
      farm.count.mockResolvedValue(2);
      const { data, metaData } = await service.farms(agent, requestId, {});
      expect(metaData.total).toBe(2);
      expect(data).toEqual([
        {
          farmId: 'farm-1',
          farmCode: 'LF-000001',
          farmName: 'Green Farm',
          farmerName: 'Musa Ali',
          farmerCode: 'FRM-000001',
          state: 'Kano',
          lga: 'Dala',
          mainProduce: 'Maize',
          listingNames: ['White maize'],
          offerId: 'offer-1',
        },
        expect.objectContaining({
          farmId: 'farm-2',
          listingNames: [],
          offerId: null,
        }),
      ]);
      const { include } = (
        farm.findMany.mock.calls[0] as [
          {
            include: {
              produce: { where: unknown };
              sourcingAllocations: { where: unknown };
            };
          },
        ]
      )[0];
      expect(include.produce.where).toEqual({
        status: { in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT] },
      });
      expect(include.sourcingAllocations.where).toEqual({
        sourcingRequestId: requestId,
      });
    });

    it('409s outside FINDING_SUPPLY', async () => {
      withRequest({ status: SourcingRequestStatus.NEGOTIATING });
      await expect(service.farms(agent, requestId, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('setOffers', () => {
    beforeEach(() => {
      sourcingAllocation.findMany.mockResolvedValue([]);
      farm.findMany.mockResolvedValue([farmRow()]);
      sourcingAllocation.create.mockImplementation(
        ({ data }: { data: { farmId: string } }) =>
          Promise.resolve({ id: `offer-${data.farmId}` }),
      );
    });

    const bags = (quantity: number, farmId = 'farm-1') => ({
      farmId,
      quantity,
      unit: SourcingUnit.BAGS,
    });

    const failureOf = async (promise: Promise<unknown>) => {
      const error: unknown = await promise.catch((caught: unknown) => caught);
      return {
        error,
        body: (error as ConflictException).getResponse(),
      };
    };

    it('offers a verified farm a quantity in its unit, with no stock check', async () => {
      withRequest(finding);
      await service.setOffers(agent, requestId, { offers: [bags(4)] });
      expect(farm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['farm-1'] } } }),
      );
      expect(produce.findMany).not.toHaveBeenCalled();
      expect(produce.updateMany).not.toHaveBeenCalled();
      expect(sourcingAllocation.create).toHaveBeenCalledWith({
        data: {
          sourcingRequestId: requestId,
          farmId: 'farm-1',
          quantity: 4,
          unit: SourcingUnit.BAGS,
        },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['farmer-user-1'],
          type: NotificationType.SOURCING_OFFER,
          params: {
            requestId,
            offerId: 'offer-farm-1',
            produceName: 'White maize',
            quantity: '4',
            unit: 'bags',
          },
        },
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          category: AuditCategory.MATCHING,
          title: 'Offer made',
          summary: '4 bags of White maize (LF-000001)',
          farmId: 'farm-1',
          // AuditEvent_actor_check: an agent row must not name a farmer.
          farmerId: null,
          sourcingRequestId: requestId,
        }),
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('offers kilograms against a tonne request', async () => {
      withRequest({ ...finding, quantity: 20, unit: SourcingUnit.TONNES });
      await service.setOffers(agent, requestId, {
        offers: [{ farmId: 'farm-1', quantity: 8000, unit: SourcingUnit.KG }],
      });
      expect(sourcingAllocation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quantity: 8000,
          unit: SourcingUnit.KG,
        }) as unknown,
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ unit: 'kg' }) as unknown,
        }),
        tx,
      );
    });

    it('400s SOURCING_UNIT_MISMATCH on a unit the request is not measured in', async () => {
      withRequest(finding);
      const { error, body } = await failureOf(
        service.setOffers(agent, requestId, {
          offers: [{ farmId: 'farm-1', quantity: 4, unit: SourcingUnit.KG }],
        }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(body).toMatchObject({ code: 'SOURCING_UNIT_MISMATCH' });
      expect(sourcingAllocation.create).not.toHaveBeenCalled();
    });

    it('409s SOURCING_FARM_UNVERIFIED on an unverified farm', async () => {
      withRequest(finding);
      farm.findMany.mockResolvedValue([
        farmRow({ verificationStatus: FarmVerificationStatus.PENDING }),
      ]);
      const { error, body } = await failureOf(
        service.setOffers(agent, requestId, { offers: [bags(4)] }),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(body).toMatchObject({ code: 'SOURCING_FARM_UNVERIFIED' });
      expect(sourcingAllocation.create).not.toHaveBeenCalled();
    });

    it('404s on an unknown farm', async () => {
      withRequest(finding);
      farm.findMany.mockResolvedValue([]);
      await expect(
        service.setOffers(agent, requestId, { offers: [bags(4)] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not re-check a kept, unchanged offer', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({
          status: SourcingOfferStatus.ACCEPTED,
          farm: farmRow({ verificationStatus: FarmVerificationStatus.PENDING }),
        }),
      ]);
      farm.findMany.mockResolvedValue([farmRow({ id: 'farm-2' })]);
      await service.setOffers(agent, requestId, {
        offers: [bags(4), bags(2, 'farm-2')],
      });
      expect(farm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['farm-2'] } } }),
      );
      expect(sourcingAllocation.update).not.toHaveBeenCalled();
      expect(sourcingAllocation.create).toHaveBeenCalledTimes(1);
    });

    it('resets a changed quantity to OFFERED and notifies again', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({
          status: SourcingOfferStatus.ACCEPTED,
          respondedAt: assignedAt,
        }),
      ]);
      await service.setOffers(agent, requestId, { offers: [bags(6)] });
      expect(sourcingAllocation.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: {
          quantity: 6,
          unit: SourcingUnit.BAGS,
          status: SourcingOfferStatus.OFFERED,
          respondedAt: null,
          rejectReason: null,
        },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.SOURCING_OFFER,
          params: expect.objectContaining({
            offerId: 'offer-1',
            quantity: '6',
          }) as unknown,
        }),
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ title: 'Offer changed' }),
      );
    });

    it('resets a changed unit to OFFERED and notifies again', async () => {
      withRequest({ ...finding, quantity: 20, unit: SourcingUnit.TONNES });
      sourcingAllocation.findMany.mockResolvedValue([
        offer({
          quantity: 4,
          unit: SourcingUnit.TONNES,
          status: SourcingOfferStatus.ACCEPTED,
          agreedUnitPrice: new Prisma.Decimal('250'),
        }),
      ]);
      await service.setOffers(agent, requestId, {
        offers: [{ farmId: 'farm-1', quantity: 4, unit: SourcingUnit.KG }],
      });
      expect(sourcingAllocation.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: expect.objectContaining({
          quantity: 4,
          unit: SourcingUnit.KG,
          status: SourcingOfferStatus.OFFERED,
          // The price was per the old unit, so it must be agreed again.
          agreedUnitPrice: null,
        }) as unknown,
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ unit: 'kg' }) as unknown,
        }),
        tx,
      );
    });

    it('leaves an unchanged offer alone', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({ status: SourcingOfferStatus.ACCEPTED }),
      ]);
      await service.setOffers(agent, requestId, { offers: [bags(4)] });
      expect(sourcingAllocation.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('withdraws a removed accepted offer and tells the farmer', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({ status: SourcingOfferStatus.ACCEPTED }),
      ]);
      await service.setOffers(agent, requestId, { offers: [] });
      expect(sourcingAllocation.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['offer-1'] } },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        {
          userIds: ['farmer-user-1'],
          type: NotificationType.SOURCING_OFFER_WITHDRAWN,
          params: { requestId, offerId: 'offer-1', produceName: 'White maize' },
        },
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          title: 'Offer withdrawn',
          summary: '4 bags of White maize (LF-000001)',
        }),
      );
    });

    it('does not notify a farmer who already rejected a removed offer', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({ status: SourcingOfferStatus.REJECTED }),
      ]);
      await service.setOffers(agent, requestId, { offers: [] });
      expect(sourcingAllocation.deleteMany).toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('409s outside FINDING_SUPPLY', async () => {
      withRequest({ status: SourcingRequestStatus.NEGOTIATING });
      await expect(
        service.setOffers(agent, requestId, { offers: [] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('setOfferPrice', () => {
    it('stores the price as a decimal and audits it', async () => {
      withRequest(finding);
      sourcingAllocation.findFirst.mockResolvedValue(offer());
      await service.setOfferPrice(agent, requestId, 'offer-1', {
        agreedUnitPrice: '1250.50',
      });
      expect(sourcingAllocation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'offer-1', sourcingRequestId: requestId },
        }),
      );
      expect(sourcingAllocation.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { agreedUnitPrice: new Prisma.Decimal('1250.50') },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          title: 'Offer priced',
          summary: 'White maize at 1250.50 per bags (LF-000001)',
          sourcingRequestId: requestId,
        }),
      );
    });

    it('404s on an offer of another request', async () => {
      withRequest(finding);
      sourcingAllocation.findFirst.mockResolvedValue(null);
      await expect(
        service.setOfferPrice(agent, requestId, 'offer-1', {
          agreedUnitPrice: '1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s outside FINDING_SUPPLY', async () => {
      withRequest({ status: SourcingRequestStatus.NEGOTIATING });
      await expect(
        service.setOfferPrice(agent, requestId, 'offer-1', {
          agreedUnitPrice: '1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('supplyComplete', () => {
    const tonnes = { ...finding, quantity: 20, unit: SourcingUnit.TONNES };
    const kg = (overrides: Record<string, unknown>) =>
      offer({
        status: SourcingOfferStatus.ACCEPTED,
        agreedUnitPrice: new Prisma.Decimal('500'),
        unit: SourcingUnit.KG,
        ...overrides,
      });

    const codeOf = async (promise: Promise<unknown>) => {
      const error: unknown = await promise.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse();
      return (body as { code: string }).code;
    };

    it('409s SOURCING_NOT_COVERED on 19,999.6 kg against 20 t', async () => {
      withRequest(tonnes);
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 10_000 }),
        kg({ id: 'b', quantity: 9_999.6 }),
      ]);
      expect(await codeOf(service.supplyComplete(agent, requestId))).toBe(
        'SOURCING_NOT_COVERED',
      );
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it('counts kg and tonne offers together against a tonne request', async () => {
      withRequest(tonnes);
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 8_000 }),
        kg({ id: 'b', quantity: 12, unit: SourcingUnit.TONNES }),
      ]);
      await service.supplyComplete(agent, requestId);
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.NEGOTIATING },
      });
    });

    it('409s SOURCING_UNPRICED on an unpriced accepted offer', async () => {
      withRequest(tonnes);
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 10_000 }),
        kg({ id: 'b', quantity: 10_000, agreedUnitPrice: null }),
      ]);
      expect(await codeOf(service.supplyComplete(agent, requestId))).toBe(
        'SOURCING_UNPRICED',
      );
    });

    it('ignores pending and rejected offers for coverage', async () => {
      withRequest(tonnes);
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 10_000 }),
        kg({ id: 'b', quantity: 10_000, status: SourcingOfferStatus.OFFERED }),
        kg({ id: 'c', quantity: 10_000, status: SourcingOfferStatus.REJECTED }),
      ]);
      expect(await codeOf(service.supplyComplete(agent, requestId))).toBe(
        'SOURCING_NOT_COVERED',
      );
    });

    it('moves to NEGOTIATING when covered and priced, ignoring unpriced pending offers', async () => {
      withRequest(tonnes);
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 20_000 }),
        kg({
          id: 'b',
          quantity: 5,
          status: SourcingOfferStatus.OFFERED,
          agreedUnitPrice: null,
        }),
      ]);
      await service.supplyComplete(agent, requestId);
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.NEGOTIATING },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          title: 'Supply complete',
          sourcingRequestId: requestId,
        }),
      );
    });

    it('409s outside FINDING_SUPPLY', async () => {
      withRequest({ ...tonnes, status: SourcingRequestStatus.NEGOTIATING });
      sourcingAllocation.findMany.mockResolvedValue([
        kg({ id: 'a', quantity: 20_000 }),
      ]);
      await expect(
        service.supplyComplete(agent, requestId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('back', () => {
    it('moves NEGOTIATING back to FINDING_SUPPLY', async () => {
      withRequest({ status: SourcingRequestStatus.NEGOTIATING });
      await service.back(agent, requestId);
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.FINDING_SUPPLY },
      });
      expect(sourcingContract.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ sourcingRequestId: requestId }),
      );
    });

    it('moves CONFIRMED back to NEGOTIATING and voids a half-signed contract', async () => {
      withRequest({ status: SourcingRequestStatus.CONFIRMED });
      sourcingContract.findFirst.mockResolvedValue({
        id: 'contract-1',
        buyerSignedAt: assignedAt,
        agentSignedAt: null,
        voidedAt: null,
      });
      await service.back(agent, requestId);
      expect(sourcingContract.updateMany).toHaveBeenCalledWith({
        where: { sourcingRequestId: requestId, voidedAt: null },
        data: { voidedAt: expect.any(Date) as Date },
      });
      expect(sourcingRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: SourcingRequestStatus.NEGOTIATING },
      });
    });

    it('409s from CONFIRMED once both have signed', async () => {
      withRequest({ status: SourcingRequestStatus.CONFIRMED });
      sourcingContract.findFirst.mockResolvedValue({
        id: 'contract-1',
        buyerSignedAt: assignedAt,
        agentSignedAt: assignedAt,
        voidedAt: null,
      });
      await expect(service.back(agent, requestId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(sourcingContract.updateMany).not.toHaveBeenCalled();
      expect(sourcingRequest.update).not.toHaveBeenCalled();
    });

    it('409s from FINDING_SUPPLY', async () => {
      withRequest(finding);
      await expect(service.back(agent, requestId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('quote', () => {
    it('quotes the priced accepted offers as strings', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({
          id: 'a',
          quantity: 4,
          status: SourcingOfferStatus.ACCEPTED,
          agreedUnitPrice: new Prisma.Decimal('1000'),
        }),
        offer({
          id: 'b',
          quantity: 9,
          agreedUnitPrice: new Prisma.Decimal('1000'),
        }),
      ]);
      const result = await service.quote(agent, requestId);
      expect(result).toMatchObject({
        subtotal: '4000.00',
        serviceFee: '200.00',
        agentCommission: '400.00',
        suggestedPrice: '4600.00',
        unpricedOffers: 0,
        lines: [
          {
            offerId: 'a',
            produceName: 'White maize',
            farmCode: 'LF-000001',
            unit: SourcingUnit.BAGS,
            quantity: 4,
            agreedUnitPrice: '1000.00',
            total: '4000.00',
            commission: '400.00',
          },
        ],
      });
    });

    it('leaves unpriced accepted offers out and counts them', async () => {
      withRequest(finding);
      sourcingAllocation.findMany.mockResolvedValue([
        offer({ id: 'a', status: SourcingOfferStatus.ACCEPTED }),
      ]);
      const result = await service.quote(agent, requestId);
      expect(result).toMatchObject({
        subtotal: '0.00',
        unpricedOffers: 1,
        lines: [],
      });
    });
  });

  describe('SetSourcingOffersDto', () => {
    const check = (offers: unknown) =>
      validate(plainToInstance(SetSourcingOffersDto, { offers }));
    const uuid = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const line = (n: number, overrides: Record<string, unknown> = {}) => ({
      farmId: uuid(n),
      quantity: 1,
      unit: SourcingUnit.KG,
      ...overrides,
    });

    it('accepts an empty list and a valid line', async () => {
      expect(await check([])).toHaveLength(0);
      expect(await check([line(1)])).toHaveLength(0);
    });

    it('rejects a repeated farmId', async () => {
      expect(await check([line(1), line(1, { quantity: 2 })])).not.toHaveLength(
        0,
      );
    });

    it('rejects more than 50 offers', async () => {
      const offers = Array.from({ length: 51 }, (_, n) => line(n));
      expect(await check(offers)).not.toHaveLength(0);
    });

    it.each([0, 1.5, -1])('rejects quantity %p', async (quantity) => {
      expect(await check([line(1, { quantity })])).not.toHaveLength(0);
    });

    it.each(['GALLONS', undefined, 'kg'])('rejects unit %p', async (unit) => {
      expect(await check([line(1, { unit })])).not.toHaveLength(0);
    });

    it('rejects a farmId that is not a uuid', async () => {
      expect(await check([line(1, { farmId: 'farm-1' })])).not.toHaveLength(0);
    });
  });

  describe('PriceSourcingOfferDto', () => {
    const check = (agreedUnitPrice: unknown) =>
      validate(plainToInstance(PriceSourcingOfferDto, { agreedUnitPrice }));

    it.each(['1', '0.01', '1250.5', '1250.50'])('accepts %p', async (price) => {
      expect(await check(price)).toHaveLength(0);
    });

    it.each(['0', '0.00', '-1', '1.234', 'abc', '', 1200, '12345678901'])(
      'rejects %p',
      async (price) => {
        expect(await check(price)).not.toHaveLength(0);
      },
    );
  });

  describe('DeclineSourcingRequestDto', () => {
    const check = (reason: unknown) =>
      validate(plainToInstance(DeclineSourcingRequestDto, { reason }));

    it('trims the reason', () => {
      expect(
        plainToInstance(DeclineSourcingRequestDto, { reason: '  busy  ' })
          .reason,
      ).toBe('busy');
    });

    it.each(['', '   ', 'x'.repeat(501), 5])('rejects %p', async (reason) => {
      expect(await check(reason)).not.toHaveLength(0);
    });

    it('accepts 500 characters', async () => {
      expect(await check('x'.repeat(500))).toHaveLength(0);
    });
  });
});
