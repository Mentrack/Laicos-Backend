import { OrderStatus, Prisma } from '../../../generated/client';
import { addDays, lagosDayStart } from '../../common/dates';
import { AdminOrderFilterDto, AdminOrderTab } from '../dto';
import { ACTIVE_STATUSES } from './active-statuses';

const TAB_WHERE: Record<AdminOrderTab, Prisma.OrderWhereInput> = {
  [AdminOrderTab.ALL]: {},
  [AdminOrderTab.ACTIVE]: { status: { in: ACTIVE_STATUSES } },
  [AdminOrderTab.DELIVERED]: { status: OrderStatus.FULFILLED },
  [AdminOrderTab.CANCELLED]: { status: OrderStatus.CANCELLED },
  [AdminOrderTab.ISSUES]: { dispute: { isNot: null } },
};

/** The tab and the status filter are ANDed, so a conflict matches nothing. */
export function adminOrderWhere(
  filter: AdminOrderFilterDto,
  tab: AdminOrderTab,
): Prisma.OrderWhereInput {
  const search = filter.search?.trim();
  const contains: Prisma.StringFilter = {
    contains: search ?? '',
    mode: 'insensitive',
  };
  const and: Prisma.OrderWhereInput[] = [TAB_WHERE[tab]];
  if (filter.status) {
    and.push({ status: filter.status });
  }
  return {
    produceId: filter.produceId,
    createdAt: createdAtRange(filter.from, filter.to),
    OR: search
      ? [
          { orderNumber: contains },
          { produceName: contains },
          { farm: { farmCode: contains } },
          { buyer: { buyerId: contains } },
          { buyer: { legalName: contains } },
          { buyer: { user: { firstName: contains } } },
          { buyer: { user: { lastName: contains } } },
        ]
      : undefined,
    AND: and.filter((condition) => Object.keys(condition).length > 0),
  };
}

// `to` is a whole day, so the bound is the start of the next one.
function createdAtRange(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  return {
    gte: from ? lagosDayStart(from) : undefined,
    lt: to ? lagosDayStart(addDays(to, 1)) : undefined,
  };
}
