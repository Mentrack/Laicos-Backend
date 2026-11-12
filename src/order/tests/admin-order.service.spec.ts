import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BuyerType, OrderStatus, ProduceType } from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { collect } from '../../common/tests/collect';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrderService } from '../admin-order.service';
import { AdminOrderTab } from '../dto';

function order(buyer: object, overrides: object = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-000001',
    createdAt: new Date('2026-10-09T10:00:00.000Z'),
    status: OrderStatus.PENDING,
    quantity: 5,
    totalPrice: { toFixed: () => '1000.00' },
    type: ProduceType.LOCAL,
    produceName: 'Maize',
    produce: { id: 'p-1', unit: 'kg' },
    buyer,
    farm: {
      id: 'f-1',
      farmCode: 'LF-000001',
      name: 'Green Acres',
      cluster: { clusterCode: 'CL-000001' },
    },
    checkout: { sourcingRequest: { id: 'sr-1', requestNumber: 'REQ-000001' } },
    dispute: null,
    ...overrides,
  };
}

const company = {
  id: 'b-1',
  buyerId: 'BYR-000001',
  buyerType: BuyerType.COMPANY,
  legalName: 'Acme Ltd',
  user: { firstName: 'Ada', lastName: 'Obi' },
};
const person = {
  ...company,
  id: 'b-2',
  buyerType: BuyerType.PERSON,
  legalName: null,
};

describe('AdminOrderService', () => {
  const database = {
    order: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { findForOrder: jest.fn() };
  let service: AdminOrderService;

  beforeEach(() => {
    jest.resetAllMocks();
    database.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    service = new AdminOrderService(
      database as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('rejects from after to', async () => {
    await expect(
      service.findAll({ from: '2026-10-10', to: '2026-10-09' }),
    ).rejects.toThrow(new BadRequestException('from must be on or before to'));
    expect(database.order.findMany).not.toHaveBeenCalled();
  });

  it('rejects from after to when counting too', async () => {
    await expect(
      service.counts({ from: '2026-10-10', to: '2026-10-09' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps rows and names COMPANY and individual buyers differently', async () => {
    database.order.findMany.mockResolvedValue([
      order(company),
      order(person, { checkout: null, dispute: { id: 'd-1', status: 'OPEN' } }),
    ]);
    database.order.count.mockResolvedValue(2);

    const { data, metaData } = await service.findAll({});

    expect(data[0]).toMatchObject({
      orderNumber: 'ORD-000001',
      unit: 'kg',
      totalPrice: '1000.00',
      produce: { id: 'p-1', name: 'Maize', type: ProduceType.LOCAL },
      buyer: { id: 'b-1', buyerId: 'BYR-000001', name: 'Acme Ltd' },
      farm: { clusterCode: 'CL-000001' },
      sourcingRequest: { id: 'sr-1', requestNumber: 'REQ-000001' },
      dispute: null,
    });
    expect(data[1].buyer.name).toBe('Ada Obi');
    expect(data[1].sourcingRequest).toBeNull();
    expect(data[1].dispute).toEqual({ id: 'd-1', status: 'OPEN' });
    expect(metaData).toEqual({ page: 1, perPage: 20, total: 2, totalPages: 1 });
  });

  it('orders by createdAt then id, newest first by default', async () => {
    database.order.findMany.mockResolvedValue([]);
    database.order.count.mockResolvedValue(0);

    await service.findAll({});
    await service.findAll({ sort: 'asc' });

    expect(database.order.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(database.order.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('lists the requested tab', async () => {
    database.order.findMany.mockResolvedValue([]);
    database.order.count.mockResolvedValue(0);

    await service.findAll({ tab: AdminOrderTab.DELIVERED });

    expect(database.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ status: OrderStatus.FULFILLED }] },
      }),
    );
  });

  it('counts each tab over the same base filter', async () => {
    database.order.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const counts = await service.counts({ produceId: 'p-1' });

    expect(counts).toEqual({
      all: 10,
      active: 4,
      delivered: 3,
      cancelled: 2,
      issues: 1,
    });
    expect(database.order.count).toHaveBeenCalledTimes(5);
    for (let call = 1; call <= 5; call++) {
      expect(database.order.count).toHaveBeenNthCalledWith(
        call,
        expect.objectContaining({
          where: expect.objectContaining({ produceId: 'p-1' }) as object,
        }),
      );
    }
  });

  describe('exportCsv', () => {
    it('writes the header and one row per order, unpaginated, with a WAT date', async () => {
      database.order.findMany.mockResolvedValue([
        order(company, {
          createdAt: new Date('2026-10-09T23:30:00.000Z'),
          produceName: 'Maize, white',
        }),
      ]);

      const csv = await collect(
        service.exportCsv({ tab: AdminOrderTab.DELIVERED }),
      );

      expect(csv).toBe(
        'Order ID,Buyer,Buyer ID,Produce,Quantity,Unit,Farm Code,Cluster,Request ID,Total (NGN),Status,Dispute,Date\r\n' +
          'ORD-000001,Acme Ltd,BYR-000001,"Maize, white",5,kg,LF-000001,CL-000001,REQ-000001,1000.00,PENDING,,2026-10-10\r\n',
      );
      const args = database.order.findMany.mock.calls[0][0] as object;
      expect(args).toEqual(
        expect.objectContaining({
          where: { AND: [{ status: OrderStatus.FULFILLED }] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1000,
        }),
      );
    });

    // Synchronous, so the 400 goes through the exception filter before any
    // CSV bytes are streamed.
    it('continues oldest first after the last row of a full batch', async () => {
      const fullBatch = Array.from({ length: 1000 }, (_, index) =>
        order(company, { id: `order-${String(index).padStart(4, '0')}` }),
      );
      const last = fullBatch[999] as { id: string; createdAt: Date };
      database.order.findMany
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce([]);

      await collect(service.exportCsv({ sort: 'asc' }));

      const second = database.order.findMany.mock.calls[1][0] as {
        where: unknown;
      };
      expect(second.where).toEqual({
        AND: [
          expect.anything(),
          {
            OR: [
              { createdAt: { gt: last.createdAt } },
              { createdAt: last.createdAt, id: { gt: last.id } },
            ],
          },
        ],
      });
    });

    it('rejects from after to before streaming', () => {
      expect(() =>
        service.exportCsv({ from: '2026-10-10', to: '2026-10-09' }),
      ).toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('404s for an unknown id', async () => {
      database.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        new NotFoundException('Order not found'),
      );
    });
  });

  describe('timeline', () => {
    it('delegates to the audit service', async () => {
      const page = { data: [], metaData: { page: 1 } };
      audit.findForOrder.mockResolvedValue(page);
      const query = { page: 2 };

      await expect(service.timeline('o-1', query)).resolves.toBe(page);
      expect(audit.findForOrder).toHaveBeenCalledWith('o-1', query);
    });
  });
});
