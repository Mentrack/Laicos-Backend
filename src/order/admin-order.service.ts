import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { toCsv } from '../common/csv';
import { lagosDay } from '../common/dates';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminOrderCountsDto,
  AdminOrderExportQueryDto,
  AdminOrderFilterDto,
  AdminOrderQueryDto,
  AdminOrderTab,
} from './dto';
import {
  ADMIN_ORDER_DETAIL_INCLUDE,
  toAdminOrderDetail,
} from './formatters/admin-order-detail.formatter';
import {
  ADMIN_ORDER_INCLUDE,
  toAdminOrderRow,
} from './formatters/admin-order.formatter';
import { adminOrderWhere } from './utils/admin-order-where';

@Injectable()
export class AdminOrderService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findOne(id: string) {
    const order = await this.database.order.findUnique({
      where: { id },
      include: ADMIN_ORDER_DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return toAdminOrderDetail(order);
  }

  timeline(id: string, query: PaginationQueryDto) {
    return this.audit.findForOrder(id, query);
  }

  async findAll(query: AdminOrderQueryDto) {
    const { where, orderBy } = listQuery(query);
    const { page, perPage, skip, take } = resolvePagination(query);
    const [orders, total] = await this.database.$transaction([
      this.database.order.findMany({
        where,
        include: ADMIN_ORDER_INCLUDE,
        orderBy,
        skip,
        take,
      }),
      this.database.order.count({ where }),
    ]);
    return {
      data: orders.map(toAdminOrderRow),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async exportCsv(query: AdminOrderExportQueryDto): Promise<string> {
    const orders = await this.database.order.findMany({
      ...listQuery(query),
      include: ADMIN_ORDER_INCLUDE,
    });
    return toCsv(
      CSV_HEADER,
      orders.map((order) => {
        const row = toAdminOrderRow(order);
        return [
          row.orderNumber,
          row.buyer.name,
          row.buyer.buyerId,
          row.produce.name,
          row.quantity,
          row.unit,
          row.farm.farmCode,
          row.farm.clusterCode,
          row.sourcingRequest?.requestNumber ?? null,
          row.totalPrice,
          row.status,
          row.dispute?.status ?? null,
          lagosDay(row.createdAt),
        ];
      }),
    );
  }

  async counts(filter: AdminOrderFilterDto): Promise<AdminOrderCountsDto> {
    assertRange(filter);
    const count = (tab: AdminOrderTab) =>
      this.database.order.count({ where: adminOrderWhere(filter, tab) });
    const [all, active, delivered, cancelled, issues] = await Promise.all([
      count(AdminOrderTab.ALL),
      count(AdminOrderTab.ACTIVE),
      count(AdminOrderTab.DELIVERED),
      count(AdminOrderTab.CANCELLED),
      count(AdminOrderTab.ISSUES),
    ]);
    return { all, active, delivered, cancelled, issues };
  }
}

const CSV_HEADER = [
  'Order ID',
  'Buyer',
  'Buyer ID',
  'Produce',
  'Quantity',
  'Unit',
  'Farm Code',
  'Cluster',
  'Request ID',
  'Total (NGN)',
  'Status',
  'Dispute',
  'Date',
];

// The list and the export must select and order the same rows.
function listQuery(query: AdminOrderExportQueryDto) {
  assertRange(query);
  const direction = query.sort ?? 'desc';
  return {
    where: adminOrderWhere(query, query.tab ?? AdminOrderTab.ALL),
    orderBy: [{ createdAt: direction }, { id: direction }],
  };
}

// YYYY-MM-DD strings compare in date order.
function assertRange({ from, to }: AdminOrderFilterDto) {
  if (from && to && from > to) {
    throw new BadRequestException('from must be on or before to');
  }
}
