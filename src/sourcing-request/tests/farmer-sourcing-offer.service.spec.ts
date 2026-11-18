import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditResource,
  Prisma,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FarmerSourcingOfferService } from '../farmer-sourcing-offer.service';

const user = { id: 'farmer-user-1' } as User;
const farmer = { id: 'farmer-1', userId: user.id };
const requestId = 'request-1';

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    sourcingRequestId: requestId,
    farmId: 'farm-1',
    produceId: null,
    quantity: 4,
    unit: SourcingUnit.BAGS,
    status: SourcingOfferStatus.OFFERED,
    respondedAt: null,
    rejectReason: null,
    agreedUnitPrice: new Prisma.Decimal('1200'),
    createdAt: new Date('2026-11-18T00:00:00.000Z'),
    sourcingRequest: {
      id: requestId,
      requestNumber: 'REQ-000001',
      produceName: 'White maize',
      requiredDate: new Date('2026-12-01T00:00:00.000Z'),
      deliveryDestination: 'Kano',
      status: SourcingRequestStatus.FINDING_SUPPLY,
    },
    ...overrides,
  };
}

describe('FarmerSourcingOfferService', () => {
  const sourcingAllocation = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const sourcingRequest = { findUnique: jest.fn() };
  const tx = { $executeRaw: jest.fn(), sourcingAllocation, sourcingRequest };
  const database = {
    ...tx,
    farmer: { findUnique: jest.fn() },
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const audit = { record: jest.fn() };
  const service = new FarmerSourcingOfferService(
    database as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  // The request is read under the lock; the offer is looked up by its own id.
  const given = (
    offer: Record<string, unknown> | null,
    status: SourcingRequestStatus = SourcingRequestStatus.FINDING_SUPPLY,
  ) => {
    sourcingAllocation.findFirst.mockResolvedValue(offer);
    sourcingRequest.findUnique.mockResolvedValue({ id: requestId, status });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    database.farmer.findUnique.mockResolvedValue(farmer);
  });

  it('lists my offers newest first, scoped to my farms', async () => {
    sourcingAllocation.findMany.mockResolvedValue([offerRow()]);
    sourcingAllocation.count.mockResolvedValue(1);

    const result = await service.findAll(user, {});

    expect(sourcingAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { farm: { ownerId: farmer.id } },
        orderBy: [{ sourcingRequest: { createdAt: 'desc' } }, { id: 'desc' }],
      }),
    );
    expect(result.data[0]).toEqual({
      id: 'offer-1',
      status: SourcingOfferStatus.OFFERED,
      quantity: 4,
      unit: SourcingUnit.BAGS,
      agreedUnitPrice: '1200.00',
      produceName: 'White maize',
      requestNumber: 'REQ-000001',
      requiredDate: new Date('2026-12-01T00:00:00.000Z'),
      deliveryDestination: 'Kano',
      requestStatus: SourcingRequestStatus.FINDING_SUPPLY,
    });
  });

  it("refuses another farmer's offer with 404", async () => {
    given(null);

    await expect(service.accept(user, 'offer-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sourcingAllocation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'offer-9',
          farm: { ownerId: farmer.id },
        }),
      }),
    );
    expect(sourcingAllocation.update).not.toHaveBeenCalled();
  });

  it('refuses to accept once the request is negotiating, leaving the row alone', async () => {
    given(offerRow(), SourcingRequestStatus.NEGOTIATING);

    await expect(service.accept(user, 'offer-1')).rejects.toMatchObject({
      response: { code: 'SOURCING_OFFER_CLOSED' },
    });
    await expect(service.accept(user, 'offer-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sourcingAllocation.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('accepts an offer and audits it as the farmer', async () => {
    given(offerRow());
    sourcingAllocation.update.mockResolvedValue({});

    await service.accept(user, 'offer-1');

    expect(sourcingAllocation.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: expect.objectContaining({
        status: SourcingOfferStatus.ACCEPTED,
        respondedAt: expect.any(Date),
        rejectReason: null,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorType: AuditActorType.FARMER,
        actorUserId: user.id,
        farmerId: farmer.id,
        farmId: 'farm-1',
        title: 'Offer accepted',
        summary: '4 bags of White maize',
        resource: AuditResource.SOURCING_REQUEST,
        sourcingRequestId: requestId,
      }),
    );
  });

  it('treats a repeat accept as a no-op with no second audit row', async () => {
    given(offerRow({ status: SourcingOfferStatus.ACCEPTED }));

    await service.accept(user, 'offer-1');

    expect(sourcingAllocation.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets a farmer reject after accepting, storing the reason', async () => {
    given(offerRow({ status: SourcingOfferStatus.ACCEPTED }));
    sourcingAllocation.update.mockResolvedValue({});

    await service.reject(user, 'offer-1', { reason: 'Crop failed' });

    expect(sourcingAllocation.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: expect.objectContaining({
        status: SourcingOfferStatus.REJECTED,
        rejectReason: 'Crop failed',
        respondedAt: expect.any(Date),
      }),
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('takes the request lock before reading the offer', async () => {
    given(offerRow());
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(0);
    });
    sourcingAllocation.findFirst.mockImplementation(() => {
      order.push('read');
      return Promise.resolve(offerRow());
    });
    sourcingAllocation.update.mockResolvedValue({});

    await service.reject(user, 'offer-1', {});

    expect(order.slice(0, 3)).toEqual(['read', 'lock', 'read']);
  });
});
