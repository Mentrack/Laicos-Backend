import {
  EvidenceStatus,
  FarmVerificationStatus,
  OrderStatus,
  ProduceStatus,
  VerificationTaskStatus,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AdminFarmService } from '../services/admin-farm.service';

const created = new Date('2026-09-01');
const visited = new Date('2026-09-22T10:00:00.000Z');
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: farmId,
    farmCode: 'LF-000001',
    ownerId: 'farmer-1',
    name: 'Green Acres',
    country: 'NG',
    stateId: 'state-1',
    state: { id: 'state-1', name: 'Oyo' },
    lgaId: 'lga-1',
    lga: { id: 'lga-1', stateId: 'state-1', name: 'Ogbomosho North' },
    location: '12 Market Road',
    size: 5,
    unit: 'ha',
    mainProduce: 'Maize',
    isExporting: false,
    referralAgentId: null,
    verificationStatus: FarmVerificationStatus.PENDING,
    isClustered: false,
    clusterId: null,
    ownershipDocumentKey: 'farms/f/ownership/a.pdf',
    chiefConfirmationKey: null,
    verifications: [],
    produce: [],
    cluster: null,
    owner: {
      id: 'farmer-1',
      farmerId: 'FRM-000001',
      status: 'ACTIVE',
      user: {
        firstName: 'Amina',
        lastName: 'Garba',
        phoneNumber: '+2348012345678',
      },
    },
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

const farmer = {
  id: 'farmer-1',
  farmerId: 'FRM-000001',
  firstName: 'Amina',
  lastName: 'Garba',
  phoneNumber: '+2348012345678',
  status: 'ACTIVE',
};

const soldWhere = {
  farmId,
  status: { notIn: [OrderStatus.CANCELLED, OrderStatus.AWAITING_PAYMENT] },
};

describe('AdminFarmService', () => {
  const farm = {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    groupBy: jest.fn(),
    updateMany: jest.fn(),
  };
  const order = { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() };
  const farmers = {
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const clusters = { count: jest.fn() };
  const database = {
    farm,
    order,
    farmer: farmers,
    cluster: clusters,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  database.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (client: typeof database) => Promise<unknown>)(database);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const storage = {
    presignedUrlOrNull: jest.fn((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    ),
    getPresignedUrl: jest.fn((key: string) =>
      Promise.resolve(`https://signed/${key}`),
    ),
  };
  const service = new AdminFarmService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    farm.findMany.mockResolvedValue([row()]);
    farm.count.mockResolvedValue(1);
    farm.findUnique.mockResolvedValue(row());
    order.aggregate.mockResolvedValue({ _sum: { quantity: null } });
    order.count.mockResolvedValue(0);
    order.findMany.mockResolvedValue([]);
  });

  it('lists a farm row without presigning documents', async () => {
    const result = await service.findAll({ page: 1, perPage: 20 });

    expect(result).toEqual({
      data: [
        {
          id: farmId,
          farmCode: 'LF-000001',
          name: 'Green Acres',
          size: 5,
          unit: 'ha',
          mainProduce: 'Maize',
          verificationStatus: FarmVerificationStatus.PENDING,
          state: { id: 'state-1', name: 'Oyo' },
          lga: { id: 'lga-1', stateId: 'state-1', name: 'Ogbomosho North' },
          farmer,
        },
      ],
      metaData: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    });
    expect(storage.presignedUrlOrNull).not.toHaveBeenCalled();
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('searches the farmer and the farm, and filters state and status', async () => {
    await service.findAll({
      page: 1,
      perPage: 20,
      search: '  amina ',
      stateId: 'state-1',
      status: FarmVerificationStatus.VERIFIED,
    });

    const contains = { contains: 'amina', mode: 'insensitive' };
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stateId: 'state-1',
          verificationStatus: FarmVerificationStatus.VERIFIED,
          OR: [
            { name: contains },
            { farmCode: contains },
            { owner: { farmerId: contains } },
            { owner: { user: { firstName: contains } } },
            { owner: { user: { lastName: contains } } },
            { owner: { user: { phoneNumber: contains } } },
          ],
        },
      }),
    );
  });

  it('ignores a blank search', async () => {
    await service.findAll({ page: 1, perPage: 20, search: '   ' });
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          OR: expect.anything(),
        }),
      }),
    );
  });

  it('returns the farm with its farmer and presigned documents', async () => {
    const detail = await service.findOne(farmId);

    expect(detail).toMatchObject({
      id: farmId,
      farmCode: 'LF-000001',
      location: '12 Market Road',
      ownershipDocumentUrl: 'https://signed/farms/f/ownership/a.pdf',
      chiefConfirmationUrl: null,
      rejectionReason: null,
      farmer,
      assignedAgent: null,
      cluster: null,
      evidence: [],
      verifications: [],
      marketplace: {
        activeProducts: 0,
        completedOrders: 0,
        totalSold: 0,
        products: [],
        recentOrders: [],
      },
    });
    expect(detail).not.toHaveProperty('idNumber');
    expect(detail).not.toHaveProperty('idDocumentUrl');
  });

  it('sums every sale and returns listings, recent orders and verification rounds', async () => {
    farm.findUnique.mockResolvedValue(
      row({
        produce: [
          {
            id: 'prod-1',
            name: 'White maize',
            quantity: 8000,
            unit: 'kg',
            pricePerUnit: { toFixed: () => '280.00' },
            status: ProduceStatus.PUBLISHED,
          },
          {
            id: 'prod-2',
            name: 'Sorghum',
            quantity: 2000,
            unit: 'crate',
            pricePerUnit: { toFixed: () => '165.00' },
            status: ProduceStatus.DRAFT,
          },
        ],
        cluster: {
          id: 'cluster-1',
          name: 'Dawakin Kudu Hub',
          _count: { farms: 3 },
          agent: {
            id: 'agent-1',
            agentId: 'AG-000001',
            user: { firstName: 'Halima', lastName: 'Bello' },
            state: { id: 'state-kano', name: 'Kano' },
            lga: {
              id: 'lga-dk',
              stateId: 'state-kano',
              name: 'Dawakin Kudu',
            },
          },
        },
        verifications: [
          {
            id: 'round-2',
            status: VerificationTaskStatus.APPROVED,
            generalNote: null,
            rejectionReason: null,
            startedAt: visited,
            decidedAt: visited,
            createdAt: visited,
            evidenceStatus: EvidenceStatus.INCOMPLETE,
            locationEvidenceKey: null,
            productionEvidenceKey: null,
            farmPlotSketchKey: 'evidence/2.jpg',
            harvestEstimateKey: null,
            agent: {
              id: 'agent-1',
              agentId: 'AG-000001',
              user: { firstName: 'Halima', lastName: 'Bello' },
            },
            evidence: [],
          },
          {
            id: 'round-1',
            status: VerificationTaskStatus.REJECTED,
            generalNote: 'Look again',
            rejectionReason: 'Boundary unclear',
            decidedAt: created,
            createdAt: created,
            evidenceStatus: EvidenceStatus.MISSING_DOCS,
            locationEvidenceKey: 'evidence/1.jpg',
            productionEvidenceKey: null,
            farmPlotSketchKey: null,
            harvestEstimateKey: null,
            agent: {
              id: 'agent-2',
              agentId: 'AG-000002',
              user: { firstName: 'Musa', lastName: 'Abubakar' },
            },
            evidence: [],
          },
        ],
      }),
    );
    order.aggregate.mockResolvedValue({ _sum: { quantity: 3000 } });
    order.count.mockResolvedValue(1);
    order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        orderNumber: 'ORD-000001',
        produceName: 'White maize',
        quantity: 1000,
        status: OrderStatus.SHIPPED,
        produce: { unit: 'kg' },
      },
    ]);

    const detail = await service.findOne(farmId);

    expect(detail.marketplace).toEqual({
      activeProducts: 1,
      completedOrders: 1,
      totalSold: 3000,
      products: [
        {
          id: 'prod-1',
          name: 'White maize',
          quantity: 8000,
          unit: 'kg',
          pricePerUnit: '280.00',
          status: ProduceStatus.PUBLISHED,
        },
        {
          id: 'prod-2',
          name: 'Sorghum',
          quantity: 2000,
          unit: 'crate',
          pricePerUnit: '165.00',
          status: ProduceStatus.DRAFT,
        },
      ],
      recentOrders: [
        {
          id: 'ord-1',
          orderNumber: 'ORD-000001',
          produceName: 'White maize',
          quantity: 1000,
          unit: 'kg',
          status: OrderStatus.SHIPPED,
        },
      ],
    });
    expect(order.aggregate).toHaveBeenCalledWith({
      where: soldWhere,
      _sum: { quantity: true },
    });
    expect(order.count).toHaveBeenCalledWith({
      where: { farmId, status: OrderStatus.FULFILLED },
    });
    expect(order.findMany).toHaveBeenCalledWith({
      where: soldWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        produceName: true,
        quantity: true,
        status: true,
        produce: { select: { unit: true } },
      },
    });
    expect(detail.cluster).toEqual({
      id: 'cluster-1',
      name: 'Dawakin Kudu Hub',
      farmCount: 3,
    });
    expect(detail.evidence).toEqual([]);
    expect(detail.assignedAgent).toEqual({
      id: 'agent-1',
      agentId: 'AG-000001',
      firstName: 'Halima',
      lastName: 'Bello',
      state: { id: 'state-kano', name: 'Kano' },
      lga: { id: 'lga-dk', stateId: 'state-kano', name: 'Dawakin Kudu' },
      farmCount: 3,
      visits: 1,
      lastVisitAt: visited,
    });
    expect(detail.verifications).toEqual([
      {
        id: 'round-2',
        status: VerificationTaskStatus.APPROVED,
        createdAt: visited,
        decidedAt: visited,
        note: null,
        evidenceStatus: EvidenceStatus.INCOMPLETE,
        informationRequestNote: null,
        informationRequestedAt: null,
        documents: {
          locationEvidenceUrl: null,
          productionEvidenceUrl: null,
          farmPlotSketchUrl: 'https://signed/evidence/2.jpg',
          harvestEstimateUrl: null,
        },
        agent: {
          id: 'agent-1',
          agentId: 'AG-000001',
          firstName: 'Halima',
          lastName: 'Bello',
        },
        evidence: [],
      },
      {
        id: 'round-1',
        status: VerificationTaskStatus.REJECTED,
        createdAt: created,
        decidedAt: created,
        note: 'Boundary unclear',
        evidenceStatus: EvidenceStatus.MISSING_DOCS,
        informationRequestNote: null,
        informationRequestedAt: null,
        documents: {
          locationEvidenceUrl: 'https://signed/evidence/1.jpg',
          productionEvidenceUrl: null,
          farmPlotSketchUrl: null,
          harvestEstimateUrl: null,
        },
        agent: {
          id: 'agent-2',
          agentId: 'AG-000002',
          firstName: 'Musa',
          lastName: 'Abubakar',
        },
        evidence: [],
      },
    ]);
  });

  it('404s a missing farm', async () => {
    farm.findUnique.mockResolvedValue(null);
    await expect(service.findOne(farmId)).rejects.toThrow('Farm not found');
  });

  it('counts the directory cards, ignoring list filters', async () => {
    farmers.count.mockResolvedValue(3);
    farm.groupBy
      .mockResolvedValueOnce([{ stateId: 'state-1' }, { stateId: 'state-2' }])
      .mockResolvedValueOnce([
        {
          verificationStatus: FarmVerificationStatus.VERIFIED,
          _count: { _all: 2 },
        },
        {
          verificationStatus: FarmVerificationStatus.PENDING,
          _count: { _all: 1 },
        },
        {
          verificationStatus: FarmVerificationStatus.REJECTED,
          _count: { _all: 1 },
        },
      ]);
    farm.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    clusters.count.mockResolvedValue(1);
    database.$queryRaw.mockResolvedValue([{ count: 2 }]);

    await expect(service.summary()).resolves.toEqual({
      totalFarmers: 3,
      stateCount: 2,
      verifiedFarms: 2,
      verificationRate: 50,
      awaitingReview: 1,
      suspendedFarms: 0,
      activeClusters: 1,
      participatingFarms: 2,
      produceTypes: 2,
    });
    expect(farm.groupBy).toHaveBeenCalledWith({ by: ['stateId'] });
    expect(farm.count).toHaveBeenCalledWith({
      where: { clusterId: { not: null } },
    });
    expect(clusters.count).toHaveBeenCalledWith({
      where: { farms: { some: {} } },
    });
    const [sql] = database.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join(' ')).toContain('lower(btrim("mainProduce"))');
    expect(sql.join(' ')).toContain(`btrim("mainProduce") <> ''`);
  });

  it('reports a verification rate of 0 when there are no farms', async () => {
    farmers.count.mockResolvedValue(0);
    farm.groupBy.mockResolvedValue([]);
    farm.count.mockResolvedValue(0);
    clusters.count.mockResolvedValue(0);
    database.$queryRaw.mockResolvedValue([{ count: 0 }]);

    await expect(service.summary()).resolves.toMatchObject({
      verifiedFarms: 0,
      verificationRate: 0,
      awaitingReview: 0,
      suspendedFarms: 0,
    });
  });

  it('suspends the farmer and every farm they own', async () => {
    farmers.findUnique.mockResolvedValue({ id: 'farmer-1' });
    order.count.mockResolvedValue(0);
    farm.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.suspend('farmer-1')).resolves.toEqual({
      id: 'farmer-1',
      status: 'DISABLED',
      farmsSuspended: 2,
    });
    expect(farmers.update).toHaveBeenCalledWith({
      where: { id: 'farmer-1' },
      data: { status: 'DISABLED' },
    });
    expect(farm.updateMany).toHaveBeenCalledWith({
      where: { ownerId: 'farmer-1' },
      data: { verificationStatus: FarmVerificationStatus.SUSPENDED },
    });
  });

  it('does not suspend when a farm has an order the buyer has paid for', async () => {
    farmers.findUnique.mockResolvedValue({ id: 'farmer-1' });
    order.count.mockResolvedValue(1);

    await expect(service.suspend('farmer-1')).rejects.toThrow(
      'Farmer has open paid orders',
    );
    expect(order.count).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.SHIPPED,
          ],
        },
        farm: { ownerId: 'farmer-1' },
      },
    });
    expect(farmers.update).not.toHaveBeenCalled();
    expect(farm.updateMany).not.toHaveBeenCalled();
  });

  it('404s a missing farmer and does not touch farms', async () => {
    farmers.findUnique.mockResolvedValue(null);

    await expect(service.suspend('missing')).rejects.toThrow(
      'Farmer not found',
    );
    expect(order.count).not.toHaveBeenCalled();
    expect(farmers.update).not.toHaveBeenCalled();
  });
});
