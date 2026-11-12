import { OrderStatus } from '../../../generated/client';
import { AdminOrderTab } from '../dto';
import { adminOrderWhere } from '../utils/admin-order-where';

describe('adminOrderWhere', () => {
  it('adds no condition for ALL', () => {
    expect(adminOrderWhere({}, AdminOrderTab.ALL)).toEqual({ AND: [] });
  });

  it('maps ACTIVE to the five live statuses', () => {
    expect(adminOrderWhere({}, AdminOrderTab.ACTIVE).AND).toEqual([
      {
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.SHIPPED,
          ],
        },
      },
    ]);
  });

  it('maps DELIVERED to FULFILLED and CANCELLED to CANCELLED', () => {
    expect(adminOrderWhere({}, AdminOrderTab.DELIVERED).AND).toEqual([
      { status: OrderStatus.FULFILLED },
    ]);
    expect(adminOrderWhere({}, AdminOrderTab.CANCELLED).AND).toEqual([
      { status: OrderStatus.CANCELLED },
    ]);
  });

  it('maps ISSUES to orders that have a dispute', () => {
    expect(adminOrderWhere({}, AdminOrderTab.ISSUES).AND).toEqual([
      { dispute: { isNot: null } },
    ]);
  });

  it('ANDs the tab with the status filter so a conflict matches nothing', () => {
    expect(
      adminOrderWhere({ status: OrderStatus.FULFILLED }, AdminOrderTab.ACTIVE)
        .AND,
    ).toEqual([
      { status: { in: expect.any(Array) as OrderStatus[] } },
      { status: OrderStatus.FULFILLED },
    ]);
  });

  it('ignores a blank search', () => {
    expect(
      adminOrderWhere({ search: '  ' }, AdminOrderTab.ALL).OR,
    ).toBeUndefined();
  });

  it('searches seven fields, insensitively and trimmed', () => {
    const contains = { contains: 'ord-9', mode: 'insensitive' };
    expect(
      adminOrderWhere({ search: ' ord-9 ' }, AdminOrderTab.ALL).OR,
    ).toEqual([
      { orderNumber: contains },
      { produceName: contains },
      { farm: { farmCode: contains } },
      { buyer: { buyerId: contains } },
      { buyer: { legalName: contains } },
      { buyer: { user: { firstName: contains } } },
      { buyer: { user: { lastName: contains } } },
    ]);
  });

  it('bounds createdAt by whole WAT days, both ends inclusive', () => {
    expect(
      adminOrderWhere(
        { from: '2026-10-09', to: '2026-10-09' },
        AdminOrderTab.ALL,
      ).createdAt,
    ).toEqual({
      gte: new Date('2026-10-08T23:00:00.000Z'),
      lt: new Date('2026-10-09T23:00:00.000Z'),
    });
  });

  it('passes produceId through', () => {
    expect(adminOrderWhere({ produceId: 'p-1' }, AdminOrderTab.ALL)).toEqual({
      produceId: 'p-1',
      AND: [],
    });
  });
});
