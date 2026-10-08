import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PackagingType,
  ProduceCondition,
  QualityGrade,
  Role,
  SourcingRequestStatus,
  SourcingTimeline,
  SourcingUnit,
  type User,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateSourcingRequestDto } from '../dto';
import { SourcingRequestService } from '../sourcing-request.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;

const dto: CreateSourcingRequestDto = {
  produceName: 'Sesame Seeds',
  quantity: 20,
  unit: SourcingUnit.TONNES,
  quality: QualityGrade.GRADE_A,
  packaging: PackagingType.BAGS,
  condition: ProduceCondition.FRESH,
  deliveryDestination: 'Warehouse A, Ibadan, Oyo State',
  requiredDate: '2026-11-15',
  timeline: SourcingTimeline.WITHIN_2_WEEKS,
};

function row() {
  return {
    id: 'req-1',
    requestNumber: 'REQ-000015',
    buyerId: buyer.id,
    ...dto,
    additionalSpecs: null,
    logisticsNotes: null,
    requiredDate: new Date('2026-11-15T00:00:00.000Z'),
    status: SourcingRequestStatus.UNDER_REVIEW,
    createdAt: new Date('2026-10-08T09:00:00.000Z'),
    updatedAt: new Date('2026-10-08T09:00:00.000Z'),
  };
}

describe('SourcingRequestService', () => {
  const database = {
    sourcingRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const service = new SourcingRequestService(
    database as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    // 10:00 in Lagos (UTC+1) on 8 October.
    jest.setSystemTime(new Date('2026-10-08T09:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    it('stores the request against the buyer and returns it formatted', async () => {
      database.sourcingRequest.create.mockResolvedValue(row());

      const result = await service.create(buyer, dto);

      expect(database.sourcingRequest.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          requiredDate: new Date('2026-11-15T00:00:00.000Z'),
          buyerId: buyer.id,
        },
      });
      expect(result).toMatchObject({
        requestNumber: 'REQ-000015',
        status: SourcingRequestStatus.UNDER_REVIEW,
        requiredDate: '2026-11-15',
      });
    });

    it('accepts today', async () => {
      database.sourcingRequest.create.mockResolvedValue(row());

      await service.create(buyer, { ...dto, requiredDate: '2026-10-08' });

      expect(database.sourcingRequest.create).toHaveBeenCalled();
    });

    it('rejects a past date', async () => {
      await expect(
        service.create(buyer, { ...dto, requiredDate: '2026-10-07' }),
      ).rejects.toThrow(
        new BadRequestException('Required date cannot be in the past'),
      );
      expect(database.sourcingRequest.create).not.toHaveBeenCalled();
    });

    it('judges "today" by the Lagos date, not UTC', async () => {
      // 23:30 UTC on 8 October is already 00:30 on 9 October in Lagos.
      jest.setSystemTime(new Date('2026-10-08T23:30:00.000Z'));

      await expect(
        service.create(buyer, { ...dto, requiredDate: '2026-10-08' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it("pages the buyer's own requests, newest first", async () => {
      database.sourcingRequest.findMany.mockResolvedValue([row()]);
      database.sourcingRequest.count.mockResolvedValue(21);

      const result = await service.findAll(buyer, { page: 2, perPage: 20 });

      expect(database.sourcingRequest.findMany).toHaveBeenCalledWith({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 20,
      });
      expect(database.sourcingRequest.count).toHaveBeenCalledWith({
        where: { buyerId: buyer.id },
      });
      expect(result.metaData).toEqual({
        page: 2,
        perPage: 20,
        total: 21,
        totalPages: 2,
      });
      expect(result.data[0].requiredDate).toBe('2026-11-15');
    });
  });

  describe('findOne', () => {
    it("looks the request up within the buyer's own", async () => {
      database.sourcingRequest.findFirst.mockResolvedValue(row());

      const result = await service.findOne(buyer, 'req-1');

      expect(database.sourcingRequest.findFirst).toHaveBeenCalledWith({
        where: { id: 'req-1', buyerId: buyer.id },
      });
      expect(result.requestNumber).toBe('REQ-000015');
    });

    it("404s on another buyer's request", async () => {
      database.sourcingRequest.findFirst.mockResolvedValue(null);

      await expect(service.findOne(buyer, 'req-2')).rejects.toThrow(
        new NotFoundException('Sourcing request not found'),
      );
    });
  });
});
