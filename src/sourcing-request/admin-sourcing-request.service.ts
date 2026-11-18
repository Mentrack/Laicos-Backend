import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  NotificationType,
  Prisma,
  SourcingOfferStatus,
  SourcingRequestStatus,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { buyerDisplayName } from '../buyer/formatters/buyer.formatter';
import { advisoryLock } from '../common/advisory-lock';
import { createdAtAfter, csvLines } from '../common/csv';
import { fromDateColumn, lagosDay } from '../common/dates';
import { fullName } from '../common/names';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { searchTokens } from '../common/search';
import { NotificationService } from '../notifications/notification.service';
import { lockCheckout } from '../payment/utils/checkout-lock';
import {
  CHECKOUT_TRANSACTION,
  busyAsConflict,
} from '../payment/utils/checkout-transaction';
import { releaseCheckout } from '../payment/utils/release-checkout';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminAllocationDto,
  AdminSourcingDetailDto,
  AdminSourcingFilterDto,
  AdminSourcingQueryDto,
  AdminSourcingRowDto,
  AdminSourcingSummaryDto,
  AssignAgentDto,
  CloseSourcingRequestDto,
} from './dto/admin-sourcing-request.dto';
import { supplyCoverage } from './utils/sourcing-pricing';
import { fulfilmentMark } from './utils/sourcing-rules';
import { voidLiveContract } from './utils/sourcing-contract';
import { moveSourcingStatus } from './utils/sourcing-transitions';

const LIVE = [CheckoutStatus.AWAITING_PAYMENT, CheckoutStatus.PAID];

const OFFER_INCLUDE = {
  farm: {
    select: {
      farmCode: true,
      name: true,
      owner: {
        select: { user: { select: { firstName: true, lastName: true } } },
      },
    },
  },
} satisfies Prisma.SourcingAllocationInclude;

@Injectable()
export class AdminSourcingRequestService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async summary(): Promise<AdminSourcingSummaryDto> {
    const groups = await this.database.sourcingRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const count = (status: SourcingRequestStatus) =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    const cards = {
      pending: count(SourcingRequestStatus.PENDING),
      assigned: count(SourcingRequestStatus.ASSIGNED),
      findingSupply: count(SourcingRequestStatus.FINDING_SUPPLY),
      negotiating: count(SourcingRequestStatus.NEGOTIATING),
      confirmed: count(SourcingRequestStatus.CONFIRMED),
      completed: count(SourcingRequestStatus.COMPLETED),
      fulfilled: count(SourcingRequestStatus.FULFILLED),
      closed: count(SourcingRequestStatus.CLOSED),
    };
    return {
      ...cards,
      total: Object.values(cards).reduce((sum, value) => sum + value, 0),
    };
  }

  async findAll(query: AdminSourcingQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = listWhere(query);
    const [rows, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        include: ROW_INCLUDE,
        orderBy: LIST_ORDER,
        skip,
        take,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      data: rows.map(toRow),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  exportCsv(filter: AdminSourcingFilterDto): AsyncGenerator<string> {
    const where = listWhere(filter);
    return csvLines<ListedRequest>(
      SOURCING_CSV_HEADER,
      (after, take) =>
        this.database.sourcingRequest.findMany({
          where: after
            ? { AND: [where, createdAtAfter(after, 'desc')] }
            : where,
          include: ROW_INCLUDE,
          orderBy: LIST_ORDER,
          take,
        }),
      (request) => {
        const row = toRow(request);
        return [
          row.requestNumber,
          row.buyerName,
          row.produceName,
          row.quantity,
          row.unit,
          row.deliveryDestination,
          row.agentName,
          row.agentCode,
          row.status,
          row.shipment,
          row.escalated ? 'Yes' : 'No',
          lagosDay(row.createdAt),
        ];
      },
    );
  }

  async findOne(id: string): Promise<AdminSourcingDetailDto> {
    const request = await this.database.sourcingRequest.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    const recentOrders = await this.database.order.findMany({
      where: { buyerId: request.buyerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, orderNumber: true, status: true },
    });
    const audit = await this.audit.findForRequest(id, { page: 1, perPage: 5 });
    // Only farmer-accepted offers count, as for the agent's supply-complete.
    const covered = supplyCoverage(
      request,
      request.allocations.filter(
        (row) => row.status === SourcingOfferStatus.ACCEPTED,
      ),
    );
    const live =
      request.checkouts.find(
        (checkout) => checkout.status === CheckoutStatus.AWAITING_PAYMENT,
      ) ??
      request.checkouts.find(
        (checkout) => checkout.status === CheckoutStatus.PAID,
      ) ??
      null;
    return {
      id: request.id,
      requestNumber: request.requestNumber,
      produceName: request.produceName,
      quantity: request.quantity,
      unit: request.unit,
      quality: request.quality,
      packaging: request.packaging,
      condition: request.condition,
      additionalSpecs: request.additionalSpecs,
      deliveryDestination: request.deliveryDestination,
      requiredDate: fromDateColumn(request.requiredDate),
      timeline: request.timeline,
      logisticsNotes: request.logisticsNotes,
      status: request.status,
      conversationId: request.conversation?.id ?? null,
      escalatedAt: request.escalatedAt,
      closedAt: request.closedAt,
      closeReason: request.closeReason,
      buyer: {
        id: request.buyer.id,
        buyerId: request.buyer.buyerId,
        buyerType: request.buyer.buyerType,
        displayName: buyerDisplayName(request.buyer),
        phoneNumber: request.buyer.user.phoneNumber,
        state: request.buyer.state?.name ?? null,
        lga: request.buyer.lga?.name ?? null,
        legalName: request.buyer.legalName,
        department: request.buyer.department,
        contactName: request.buyer.contactName,
        contactPhone: request.buyer.contactPhone,
        paymentTerms: request.buyer.paymentTerms,
        recentOrders,
      },
      assignment: request.assignedAgent
        ? {
            agentId: request.assignedAgent.id,
            agentCode: request.assignedAgent.agentId,
            name: fullName(request.assignedAgent.user),
            clusterName: request.assignedAgent.cluster?.name ?? null,
            clusterCode: request.assignedAgent.cluster?.clusterCode ?? null,
          }
        : null,
      allocations: request.allocations.map(allocationRow),
      coverage: covered,
      checkout: live
        ? {
            id: live.id,
            status: live.status,
            expiresAt: live.expiresAt,
            total: live.totalPrice.toFixed(2),
          }
        : null,
      orders: (live?.orders ?? []).map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        farmCode: order.farm.farmCode,
        quantity: order.quantity,
        status: order.status,
        handoverStatus: order.handover?.status ?? null,
      })),
      audit: audit.data,
    };
  }

  async assign(admin: User, id: string, dto: AssignAgentDto) {
    const deliveryIds = await busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireRequest(id, tx);
        const agent = await tx.agent.findUnique({
          where: { id: dto.agentId },
          include: { user: true },
        });
        if (!agent) {
          throw new NotFoundException('Agent not found');
        }
        if (!agent.isVerified) {
          throw new ConflictException('The agent must be verified');
        }
        await moveSourcingStatus(
          tx,
          id,
          SourcingRequestStatus.ASSIGNED,
          'ADMIN',
        );
        // A reassignment restarts the agent's response window.
        await tx.sourcingRequest.update({
          where: { id },
          data: { assignedAgentId: agent.id, assignedAt: new Date() },
        });
        await this.audit.record(tx, {
          actorType: AuditActorType.ADMIN,
          actorUserId: admin.id,
          farmerId: null,
          agentId: agent.id,
          farmId: null,
          category: AuditCategory.ASSIGNMENT,
          title: request.assignedAgentId
            ? 'Agent reassigned'
            : 'Agent assigned',
          summary: `${fullName(agent.user)} (${agent.agentId})`,
          actionLabel: 'View agent',
          resource: AuditResource.AGENT,
          resourceId: agent.id,
          sourcingRequestId: id,
        });
        return this.notifications.notify(
          {
            userIds: [agent.userId],
            type: NotificationType.SOURCING_ASSIGNED,
            params: {
              requestId: id,
              requestNumber: request.requestNumber,
              produceName: request.produceName,
            },
          },
          tx,
        );
      }, CHECKOUT_TRANSACTION),
    );
    void this.notifications.dispatch(deliveryIds);
    return this.findOne(id);
  }

  async escalate(admin: User, id: string) {
    await this.database.$transaction(async (tx) => {
      const request = await this.requireRequest(id, tx);
      if (
        request.status === SourcingRequestStatus.FULFILLED ||
        request.status === SourcingRequestStatus.CLOSED
      ) {
        throw new ConflictException('This request can no longer be escalated');
      }
      if (request.escalatedAt) {
        return;
      }
      await tx.sourcingRequest.update({
        where: { id },
        data: { escalatedAt: new Date() },
      });
      await this.audit.record(tx, {
        actorType: AuditActorType.ADMIN,
        actorUserId: admin.id,
        farmerId: null,
        agentId: request.assignedAgentId,
        farmId: null,
        category: AuditCategory.SOURCING,
        title: 'Request escalated',
        summary: request.requestNumber,
        actionLabel: 'View request',
        resource: AuditResource.SOURCING_REQUEST,
        resourceId: id,
        sourcingRequestId: id,
      });
    });
    return this.findOne(id);
  }

  async close(admin: User, id: string, dto: CloseSourcingRequestDto) {
    await busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireRequest(id, tx);
        const awaiting = await tx.checkout.findFirst({
          where: {
            sourcingRequestId: id,
            status: CheckoutStatus.AWAITING_PAYMENT,
          },
        });
        // The payment webhook locks the checkout and then writes the request
        // row, so take the checkout lock before touching the request.
        if (awaiting) {
          await lockCheckout(tx, awaiting.id);
        }
        // Re-read after the checkout lock: a payment that landed meanwhile
        // has made the request COMPLETED, which an admin cannot close.
        await moveSourcingStatus(tx, id, SourcingRequestStatus.CLOSED, 'ADMIN');
        await tx.sourcingRequest.update({
          where: { id },
          data: { closedAt: new Date(), closeReason: dto.reason },
        });
        if (request.status === SourcingRequestStatus.CONFIRMED) {
          await voidLiveContract(tx, id);
        }
        if (awaiting) {
          await releaseCheckout(
            tx,
            awaiting.id,
            CheckoutStatus.CANCELLED,
            dto.reason,
            { type: AuditActorType.ADMIN, userId: admin.id },
          );
        }
        await this.audit.record(tx, {
          actorType: AuditActorType.ADMIN,
          actorUserId: admin.id,
          farmerId: null,
          agentId: request.assignedAgentId,
          farmId: null,
          category: AuditCategory.SOURCING,
          title: 'Request closed',
          summary: awaiting
            ? `${dto.reason}. Unpaid checkout released`
            : dto.reason,
          actionLabel: 'View request',
          resource: AuditResource.SOURCING_REQUEST,
          resourceId: id,
          sourcingRequestId: id,
        });
      }, CHECKOUT_TRANSACTION),
    );
    return this.findOne(id);
  }

  private async requireRequest(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.database,
  ) {
    const request = await tx.sourcingRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    return request;
  }
}

const ROW_INCLUDE = {
  buyer: {
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
  },
  assignedAgent: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  checkouts: {
    where: { status: CheckoutStatus.PAID },
    include: { orders: { select: { status: true } } },
  },
} satisfies Prisma.SourcingRequestInclude;

const DETAIL_INCLUDE = {
  buyer: {
    include: {
      user: { select: { firstName: true, lastName: true, phoneNumber: true } },
      state: true,
      lga: true,
    },
  },
  assignedAgent: {
    include: {
      user: { select: { firstName: true, lastName: true } },
      cluster: true,
    },
  },
  allocations: { include: OFFER_INCLUDE, orderBy: { id: 'asc' } },
  checkouts: {
    where: { status: { in: LIVE } },
    include: {
      orders: {
        include: {
          farm: { select: { farmCode: true } },
          handover: { select: { status: true } },
        },
      },
    },
  },
  conversation: { select: { id: true } },
} satisfies Prisma.SourcingRequestInclude;

// The id tiebreak keeps paging and export batches stable when two requests
// share a createdAt.
const LIST_ORDER: Prisma.SourcingRequestOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

const SOURCING_CSV_HEADER = [
  'Request ID',
  'Buyer',
  'Produce',
  'Quantity',
  'Unit',
  'Destination',
  'Agent',
  'Agent ID',
  'Status',
  'Shipment',
  'Escalated',
  'Date',
];

type ListedRequest = Prisma.SourcingRequestGetPayload<{
  include: typeof ROW_INCLUDE;
}>;
type DetailAllocation = Prisma.SourcingRequestGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>['allocations'][number];

function listWhere(
  filter: AdminSourcingFilterDto,
): Prisma.SourcingRequestWhereInput {
  return {
    ...searchWhere(filter.search),
    ...(filter.status ? { status: filter.status } : {}),
  };
}

function toRow(row: ListedRequest): AdminSourcingRowDto {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    buyerName: buyerDisplayName(row.buyer),
    produceName: row.produceName,
    quantity: row.quantity,
    unit: row.unit,
    deliveryDestination: row.deliveryDestination,
    agentName: row.assignedAgent ? fullName(row.assignedAgent.user) : null,
    agentCode: row.assignedAgent?.agentId ?? null,
    status: row.status,
    createdAt: row.createdAt,
    escalated: row.escalatedAt !== null,
    shipment:
      row.status === SourcingRequestStatus.COMPLETED
        ? fulfilmentMark(paidOrders(row.checkouts))
        : null,
  };
}

function paidOrders(
  checkouts: {
    orders: {
      status: Prisma.OrderGetPayload<{ select: { status: true } }>['status'];
    }[];
  }[],
) {
  return checkouts.flatMap((checkout) => checkout.orders);
}

function searchWhere(search?: string): Prisma.SourcingRequestWhereInput {
  const tokens = searchTokens(search);
  if (tokens.length === 0) {
    return {};
  }
  return {
    AND: tokens.map((token) => ({
      OR: [
        { requestNumber: { contains: token, mode: 'insensitive' as const } },
        { produceName: { contains: token, mode: 'insensitive' as const } },
        {
          buyer: {
            legalName: { contains: token, mode: 'insensitive' as const },
          },
        },
        {
          buyer: {
            user: {
              firstName: { contains: token, mode: 'insensitive' as const },
            },
          },
        },
        {
          buyer: {
            user: {
              lastName: { contains: token, mode: 'insensitive' as const },
            },
          },
        },
      ],
    })),
  };
}

function allocationRow(row: DetailAllocation): AdminAllocationDto {
  return {
    id: row.id,
    status: row.status,
    agreedUnitPrice: row.agreedUnitPrice?.toFixed(2) ?? null,
    farmId: row.farmId,
    farmCode: row.farm.farmCode,
    farmName: row.farm.name,
    farmerName: fullName(row.farm.owner.user),
    quantity: row.quantity,
    unit: row.unit,
  };
}
