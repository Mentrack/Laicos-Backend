import {
  FarmVerificationStatus,
  Prisma,
  ProduceCategory,
  ProduceStatus,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminProduceService } from '../admin-produce.service';

const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const listedAt = new Date('2026-10-09T00:00:00.000Z');

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: produceId,
    farmId: 'farm-1',
    name: 'Premium Sesame Seeds',
    category: 'OILSEEDS',
    pricePerUnit: { toFixed: () => '1250.00' },
    unit: 'kg',
    floatingQuantity: 2000,
    status: ProduceStatus.PUBLISHED,
    createdAt: listedAt,
    farm: {
      id: 'farm-1',
      farmCode: 'LF-000018',
      name: 'Green Acres',
      verificationStatus: FarmVerificationStatus.VERIFIED,
    },
    ...overrides,
  };
}

describe('AdminProduceService', () => {
  const produce = {
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const order = { count: jest.fn() };
  const cluster = { count: jest.fn() };
  const farm = { findUnique: jest.fn() };
  const database = {
    produce,
    order,
    cluster,
    farm,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  database.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (client: typeof database) => Promise<unknown>)(database);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const service = new AdminProduceService(database as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    produce.findMany.mockResolvedValue([listing()]);
    produce.count.mockResolvedValue(1);
    produce.findUnique.mockResolvedValue({
      id: produceId,
      status: ProduceStatus.PUBLISHED,
    });
    produce.update.mockResolvedValue({
      id: produceId,
      status: ProduceStatus.DISABLED,
    });
    produce.delete.mockResolvedValue({ id: produceId });
    order.count.mockResolvedValue(0);
  });

  it('lists every listing newest first, including drafts', async () => {
    const result = await service.findAll({ page: 1, perPage: 20 });

    expect(result).toEqual({
      data: [
        {
          id: produceId,
          name: 'Premium Sesame Seeds',
          farmId: 'farm-1',
          farmCode: 'LF-000018',
          category: 'OILSEEDS',
          pricePerUnit: '1250.00',
          unit: 'kg',
          floatingQuantity: 2000,
          status: ProduceStatus.PUBLISHED,
          createdAt: listedAt,
        },
      ],
      metaData: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    });
    expect(produce.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('returns one farm’s listings', async () => {
    const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
    farm.findUnique.mockResolvedValue({ id: farmId });

    const result = await service.findByFarm(farmId, { page: 1, perPage: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].farmId).toBe('farm-1');
    expect(produce.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { farmId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('404s produce for a missing farm', async () => {
    farm.findUnique.mockResolvedValue(null);

    await expect(
      service.findByFarm('6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11', {
        page: 1,
        perPage: 20,
      }),
    ).rejects.toThrow('Farm not found');
    expect(produce.findMany).not.toHaveBeenCalled();
  });

  it('searches the product and the farm, and filters category and status', async () => {
    await service.findAll({
      page: 1,
      perPage: 20,
      search: '  sesame ',
      category: ProduceCategory.OILSEEDS,
      status: ProduceStatus.DRAFT,
    });

    const contains = { contains: 'sesame', mode: 'insensitive' };
    expect(produce.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: 'OILSEEDS',
          status: ProduceStatus.DRAFT,
          OR: [
            { name: contains },
            { farm: { name: contains } },
            { farm: { farmCode: contains } },
          ],
        },
      }),
    );
  });

  it('counts the product cards, ignoring the table filters', async () => {
    produce.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    produce.groupBy
      .mockResolvedValueOnce([
        { status: ProduceStatus.PUBLISHED, _count: { _all: 2 } },
        { status: ProduceStatus.SOLD_OUT, _count: { _all: 1 } },
        { status: ProduceStatus.DRAFT, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { category: 'GRAINS', _count: { _all: 2 } },
        { category: 'OILSEEDS', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ farmId: 'farm-1' }, { farmId: 'farm-2' }]);
    database.$queryRaw.mockResolvedValue([{ sum: 42800 }]);
    cluster.count.mockResolvedValue(3);

    await expect(service.summary()).resolves.toEqual({
      totalProducts: 4,
      categoryCount: 2,
      participatingFarms: 2,
      activeListings: 3,
      inactiveListings: 1,
      availableStockKg: 42800,
      activeClusters: 3,
      recentListings: 1,
    });
    expect(cluster.count).toHaveBeenCalledWith({
      where: { farms: { some: { produce: { some: {} } } } },
    });
    expect(produce.groupBy).toHaveBeenCalledWith({
      by: ['category'],
      where: { category: { not: null } },
      _count: { _all: true },
    });
    const recent = produce.count.mock.calls[1] as [
      { where: { createdAt: { gte: Date } } },
    ];
    const age = Date.now() - recent[0].where.createdAt.gte.getTime();
    expect(age).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 5_000);
    expect(age).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 5_000);
    const [sql] = database.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join(' ')).toContain(`lower(btrim(unit)) = 'kg'`);
  });

  it('disables a listing that has no open paid order', async () => {
    await expect(service.disable(produceId)).resolves.toEqual({
      id: produceId,
      status: ProduceStatus.DISABLED,
    });
    expect(order.count).toHaveBeenCalledWith({
      where: {
        produceId,
        status: {
          in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SHIPPED'],
        },
      },
    });
    expect(produce.update).toHaveBeenCalledWith({
      where: { id: produceId },
      data: { status: ProduceStatus.DISABLED },
    });
  });

  it('does not disable a listing with an order the buyer has paid for', async () => {
    order.count.mockResolvedValue(1);

    await expect(service.disable(produceId)).rejects.toThrow(
      'Produce has open paid orders',
    );
    expect(produce.update).not.toHaveBeenCalled();
  });

  it('404s a missing listing on disable', async () => {
    produce.findUnique.mockResolvedValue(null);

    await expect(service.disable('missing')).rejects.toThrow(
      'Produce not found',
    );
    expect(order.count).not.toHaveBeenCalled();
  });

  it('deletes a disabled listing', async () => {
    produce.findUnique.mockResolvedValue({
      id: produceId,
      status: ProduceStatus.DISABLED,
    });

    await expect(service.remove(produceId)).resolves.toEqual({
      id: produceId,
      status: ProduceStatus.DISABLED,
    });
    expect(produce.delete).toHaveBeenCalledWith({ where: { id: produceId } });
  });

  it('refuses to delete a listing that is not disabled', async () => {
    await expect(service.remove(produceId)).rejects.toThrow(
      'Disable the listing before removing it',
    );
    expect(produce.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a disabled listing that already has orders', async () => {
    produce.findUnique.mockResolvedValue({
      id: produceId,
      status: ProduceStatus.DISABLED,
    });
    produce.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.remove(produceId)).rejects.toThrow(
      'Produce has orders and cannot be deleted',
    );
  });

  it('404s a missing listing on remove', async () => {
    produce.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toThrow(
      'Produce not found',
    );
    expect(produce.delete).not.toHaveBeenCalled();
  });
});
