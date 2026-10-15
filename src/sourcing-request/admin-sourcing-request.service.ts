import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  BuyerType,
  CheckoutStatus,
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  SourcingRequestStatus,
  type SourcingUnit,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { CreateCheckoutDto } from '../cart/dto';
import {
  CHECKOUT_INCLUDE,
  formatCheckout,
} from '../cart/formatters/checkout.formatter';
import {
  createCheckout,
  findReplay,
  resolveDelivery,
} from '../cart/utils/place-checkout';
import { advisoryLock } from '../common/advisory-lock';
import { fromDateColumn } from '../common/dates';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { orderLine, tryReserveProduce } from '../order/utils/reservation';
import { CheckoutConfig } from '../payment/checkout-config';
import { lockCheckout } from '../payment/utils/checkout-lock';
import {
  CHECKOUT_TRANSACTION,
  busyAsConflict,
} from '../payment/utils/checkout-transaction';
import { releaseCheckout } from '../payment/utils/release-checkout';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminSourcingQueryDto,
  AdminSourcingSummaryDto,
  AssignAgentDto,
  CloseSourcingRequestDto,
  SaveAllocationsDto,
} from './dto/admin-sourcing-request.dto';
import {
  coverage,
  fulfilmentMark,
  isListingEligible,
  requestedAmount,
  unitsComparable,
} from './utils/sourcing-rules';
import { syncSourcingRequest } from './utils/sync-sourcing-request';

const LIVE = [CheckoutStatus.AWAITING_PAYMENT, CheckoutStatus.PAID];
const OPEN_FOR_MATCH: SourcingRequestStatus[] = [
  SourcingRequestStatus.NEW,
  SourcingRequestStatus.IN_REVIEW,
  SourcingRequestStatus.FINDING_SUPPLY,
];

const LISTING_INCLUDE = {
  farm: {
    include: {
      cluster: { select: { id: true } },
      owner: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.ProduceInclude;

@Injectable()
export class AdminSourcingRequestService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AuditService,
    private readonly config: CheckoutConfig,
  ) {}

  async summary(): Promise<AdminSourcingSummaryDto> {
    const groups = await this.database.sourcingRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const count = (status: SourcingRequestStatus) =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    const cards = {
      new: count(SourcingRequestStatus.NEW),
      inReview: count(SourcingRequestStatus.IN_REVIEW),
      findingSupply: count(SourcingRequestStatus.FINDING_SUPPLY),
      awaitingBuyer: count(SourcingRequestStatus.AWAITING_BUYER),
      confirmed: count(SourcingRequestStatus.CONFIRMED),
      fulfilment: count(SourcingRequestStatus.FULFILMENT),
      completed: count(SourcingRequestStatus.COMPLETED),
      closed: count(SourcingRequestStatus.CLOSED),
    };
    return {
      ...cards,
      total: Object.values(cards).reduce((sum, value) => sum + value, 0),
    };
  }

  async findAll(query: AdminSourcingQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.SourcingRequestWhereInput = {
      ...searchWhere(query.search),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        include: ROW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        requestNumber: row.requestNumber,
        buyerName: displayName(row.buyer),
        produceName: row.produceName,
        quantity: row.quantity,
        unit: row.unit,
        deliveryDestination: row.deliveryDestination,
        agentName: row.assignedAgent
          ? fullName(row.assignedAgent.user)
          : null,
        agentCode: row.assignedAgent?.agentId ?? null,
        status: row.status,
        createdAt: row.createdAt,
        escalated: row.escalatedAt !== null,
        shipment:
          row.status === SourcingRequestStatus.FULFILMENT
            ? fulfilmentMark(paidOrders(row.checkouts))
            : null,
      })),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(id: string) {
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
    const selected = request.allocations.reduce(
      (sum, row) => sum + comparableQuantity(request.unit, row.produce.unit, row.quantity),
      0,
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
      escalatedAt: request.escalatedAt,
      closedAt: request.closedAt,
      closeReason: request.closeReason,
      buyer: {
        id: request.buyer.id,
        buyerId: request.buyer.buyerId,
        buyerType: request.buyer.buyerType,
        displayName: displayName(request.buyer),
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
          }
        : null,
      allocations: request.allocations.map((row) =>
        allocationRow(row.produce, row.quantity),
      ),
      coverage: coverage(requestedAmount(request.quantity, request.unit), selected),
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
        conversationId: order.conversation?.id ?? null,
      })),
      audit: audit.data,
    };
  }

  async listings(id: string) {
    const request = await this.requireRequest(id);
    if (!request.assignedAgentId) {
      throw new ConflictException('Assign an agent before matching listings');
    }
    const agent = await this.database.agent.findUnique({
      where: { id: request.assignedAgentId },
      include: { cluster: true },
    });
    if (!agent?.cluster) {
      throw new NotFoundException('Agent not found');
    }
    const produces = await this.database.produce.findMany({
      where: {
        status: ProduceStatus.PUBLISHED,
        floatingQuantity: { gte: 1 },
        farm: {
          verificationStatus: FarmVerificationStatus.VERIFIED,
          clusterId: agent.cluster.id,
        },
      },
      include: LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return produces
      .filter((produce) =>
        isListingEligible({
          statusPublished: true,
          floatingQuantity: produce.floatingQuantity,
          listingName: produce.name,
          requestName: request.produceName,
          farmVerified: true,
          inAgentCluster: true,
          requestUnit: request.unit,
          listingUnit: produce.unit,
        }),
      )
      .map((produce) => allocationRow(produce));
  }

  async assign(id: string, dto: AssignAgentDto) {
    await busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireRequest(id, tx);
        if (!OPEN_FOR_MATCH.includes(request.status)) {
          throw new ConflictException(
            'The agent cannot change after a checkout is placed',
          );
        }
        const agent = await tx.agent.findUnique({
          where: { id: dto.agentId },
          include: { cluster: true, user: true },
        });
        if (!agent) {
          throw new NotFoundException('Agent not found');
        }
        if (!agent.isVerified || !agent.cluster) {
          throw new ConflictException('The agent must be verified');
        }
        const allocations = await tx.sourcingAllocation.findMany({
          where: { sourcingRequestId: id },
          include: { produce: { select: { farm: { select: { clusterId: true } } } } },
        });
        if (
          allocations.some(
            (row) => row.produce.farm.clusterId !== agent.cluster!.id,
          )
        ) {
          throw new ConflictException(
            'The saved listings are outside that agent’s cluster',
          );
        }
        const changed = request.assignedAgentId !== agent.id;
        await tx.sourcingRequest.update({
          where: { id },
          data: { assignedAgentId: agent.id },
        });
        await syncSourcingRequest(tx, id);
        if (changed) {
          await this.audit.record(tx, {
            actorType: AuditActorType.ADMIN,
            farmerId: null,
            agentId: agent.id,
            farmId: null,
            category: AuditCategory.ASSIGNMENT,
            title: request.assignedAgentId ? 'Agent reassigned' : 'Agent assigned',
            summary: `${fullName(agent.user)} (${agent.agentId})`,
            actionLabel: 'View agent',
            resource: AuditResource.AGENT,
            resourceId: agent.id,
            sourcingRequestId: id,
          });
        }
      }, CHECKOUT_TRANSACTION),
    );
    return this.findOne(id);
  }

  async save(id: string, dto: SaveAllocationsDto) {
    await busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireRequest(id, tx);
        if (!request.assignedAgentId) {
          throw new ConflictException('Assign an agent before matching listings');
        }
        if (!OPEN_FOR_MATCH.includes(request.status)) {
          throw new ConflictException(
            'The selection cannot change after a checkout is placed',
          );
        }
        const agent = await tx.agent.findUniqueOrThrow({
          where: { id: request.assignedAgentId },
          include: { cluster: true },
        });
        const current = await tx.sourcingAllocation.findMany({
          where: { sourcingRequestId: id },
        });
        const next = await this.checkedItems(tx, request, agent.cluster?.id, dto);
        await tx.sourcingAllocation.deleteMany({
          where: { sourcingRequestId: id },
        });
        if (next.length > 0) {
          await tx.sourcingAllocation.createMany({
            data: next.map((item) => ({
              sourcingRequestId: id,
              produceId: item.produceId,
              quantity: item.quantity,
            })),
          });
        }
        await syncSourcingRequest(tx, id);
        if (!sameGroup(current, next)) {
          await this.audit.record(tx, {
            actorType: AuditActorType.ADMIN,
            farmerId: null,
            agentId: request.assignedAgentId,
            farmId: null,
            category: AuditCategory.MATCHING,
            title: next.length === 0 ? 'Selection cleared' : 'Supply selection updated',
            summary:
              next.length === 0
                ? 'No listings selected'
                : next
                    .map((item) => `${item.produceId} ${item.quantity}`)
                    .join(', '),
            actionLabel: 'View request',
            resource: AuditResource.SOURCING_REQUEST,
            resourceId: id,
            sourcingRequestId: id,
          });
        }
      }, CHECKOUT_TRANSACTION),
    );
    return this.findOne(id);
  }

  confirm(id: string, idempotencyKey: string, dto: CreateCheckoutDto) {
    return busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await tx.sourcingRequest.findUnique({
          where: { id },
          include: {
            allocations: { include: { produce: { include: LISTING_INCLUDE } } },
            checkouts: { where: { status: { in: LIVE } }, select: { id: true, status: true } },
          },
        });
        if (!request) {
          throw new NotFoundException('Sourcing request not found');
        }
        const replay = await findReplay(tx, request.buyerId, idempotencyKey);
        if (replay) {
          if (replay.sourcingRequestId !== id) {
            throw new ConflictException(
              'Idempotency-Key already belongs to another checkout',
            );
          }
          return formatCheckout(replay);
        }
        if (request.checkouts.length > 0) {
          throw new ConflictException('This request already has a checkout');
        }
        if (request.allocations.length === 0) {
          throw new ConflictException('Select at least one listing');
        }
        const selected = request.allocations.reduce(
          (sum, row) =>
            sum + comparableQuantity(request.unit, row.produce.unit, row.quantity),
          0,
        );
        if (selected < requestedAmount(request.quantity, request.unit)) {
          throw new ConflictException('The selection does not cover the request');
        }
        const clusterId = request.allocations[0]?.produce.farm.clusterId;
        for (const row of request.allocations) {
          if (
            !isListingEligible({
              statusPublished: row.produce.status === ProduceStatus.PUBLISHED,
              floatingQuantity: row.produce.floatingQuantity,
              listingName: row.produce.name,
              requestName: request.produceName,
              farmVerified:
                row.produce.farm.verificationStatus ===
                FarmVerificationStatus.VERIFIED,
              inAgentCluster: row.produce.farm.clusterId === clusterId,
              requestUnit: request.unit,
              listingUnit: row.produce.unit,
            }) ||
            row.quantity > row.produce.floatingQuantity
          ) {
            throw new ConflictException(
              'A selected listing is no longer eligible',
            );
          }
        }
        const delivery = await resolveDelivery(
          tx,
          request.buyerId,
          dto.addressId,
          dto.deliveryDate,
          this.config,
        );
        const ordered = [...request.allocations].sort((a, b) =>
          a.produceId.localeCompare(b.produceId),
        );
        const lines: ReturnType<typeof orderLine>[] = [];
        for (const row of ordered) {
          const { produce, reserved } = await tryReserveProduce(
            tx,
            row.produceId,
            row.quantity,
          );
          if (!reserved || !produce) {
            throw new ConflictException('A selected listing is no longer eligible');
          }
          lines.push(orderLine(produce, row.quantity));
        }
        const checkout = await createCheckout(
          tx,
          {
            buyerId: request.buyerId,
            idempotencyKey,
            lines,
            delivery,
            expectedTotal: dto.expectedTotal,
            sourcingRequestId: id,
          },
          this.config,
        );
        await this.audit.record(tx, {
          actorType: AuditActorType.ADMIN,
          farmerId: null,
          agentId: request.assignedAgentId,
          farmId: null,
          category: AuditCategory.MATCHING,
          title: 'Supply confirmed',
          summary: checkout.checkoutNumber,
          actionLabel: 'View request',
          resource: AuditResource.SOURCING_REQUEST,
          resourceId: id,
          sourcingRequestId: id,
        });
        await syncSourcingRequest(tx, id);
        return formatCheckout(checkout);
      }, CHECKOUT_TRANSACTION),
    );
  }

  async escalate(id: string) {
    await this.database.$transaction(async (tx) => {
      const request = await this.requireRequest(id, tx);
      if (
        request.status === SourcingRequestStatus.COMPLETED ||
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

  async close(id: string, dto: CloseSourcingRequestDto) {
    await busyAsConflict(() =>
      this.database.$transaction(async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireRequest(id, tx);
        if (
          request.status === SourcingRequestStatus.COMPLETED ||
          request.status === SourcingRequestStatus.CLOSED
        ) {
          throw new ConflictException('This request is already finished');
        }
        if (
          request.status === SourcingRequestStatus.CONFIRMED ||
          request.status === SourcingRequestStatus.FULFILMENT
        ) {
          throw new ConflictException(
            'Cancel the open orders before closing this request',
          );
        }
        const awaiting = await tx.checkout.findFirst({
          where: {
            sourcingRequestId: id,
            status: CheckoutStatus.AWAITING_PAYMENT,
          },
        });
        await tx.sourcingRequest.update({
          where: { id },
          data: { closedAt: new Date(), closeReason: dto.reason },
        });
        if (awaiting) {
          await lockCheckout(tx, awaiting.id);
          await releaseCheckout(
            tx,
            awaiting.id,
            CheckoutStatus.CANCELLED,
            dto.reason,
          );
        }
        await syncSourcingRequest(tx, id);
        await this.audit.record(tx, {
          actorType: AuditActorType.ADMIN,
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

  private async checkedItems(
    tx: Prisma.TransactionClient,
    request: { produceName: string; unit: SourcingUnit },
    clusterId: string | undefined,
    dto: SaveAllocationsDto,
  ) {
    const seen = new Set<string>();
    const items: SaveAllocationsDto['items'] = [];
    for (const item of dto.items) {
      if (seen.has(item.produceId)) {
        throw new ConflictException('A listing can only be selected once');
      }
      seen.add(item.produceId);
      const produce = await tx.produce.findUnique({
        where: { id: item.produceId },
        include: LISTING_INCLUDE,
      });
      if (!produce) {
        throw new NotFoundException('Listing not found');
      }
      if (
        !clusterId ||
        !isListingEligible({
          statusPublished: produce.status === ProduceStatus.PUBLISHED,
          floatingQuantity: produce.floatingQuantity,
          listingName: produce.name,
          requestName: request.produceName,
          farmVerified:
            produce.farm.verificationStatus === FarmVerificationStatus.VERIFIED,
          inAgentCluster: produce.farm.clusterId === clusterId,
          requestUnit: request.unit,
          listingUnit: produce.unit,
        }) ||
        item.quantity > produce.floatingQuantity
      ) {
        throw new ConflictException('A selected listing is not eligible');
      }
      if (!unitsComparable(request.unit, produce.unit)) {
        throw new ConflictException('A selected listing is not eligible');
      }
      items.push(item);
    }
    return items;
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
  allocations: {
    include: { produce: { include: LISTING_INCLUDE } },
  },
  checkouts: {
    where: { status: { in: LIVE } },
    include: {
      orders: {
        include: {
          farm: { select: { farmCode: true } },
          handover: { select: { status: true } },
          conversation: { select: { id: true } },
        },
      },
    },
  },
} satisfies Prisma.SourcingRequestInclude;

function displayName(buyer: {
  buyerType: BuyerType;
  legalName: string | null;
  user: { firstName: string; lastName: string };
}): string {
  if (buyer.buyerType === BuyerType.COMPANY && buyer.legalName) {
    return buyer.legalName;
  }
  return fullName(buyer.user);
}

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function paidOrders(
  checkouts: { orders: { status: Prisma.OrderGetPayload<{ select: { status: true } }>['status'] }[] }[],
) {
  return checkouts.flatMap((checkout) => checkout.orders);
}

function comparableQuantity(
  requestUnit: SourcingUnit,
  listingUnit: string,
  quantity: number,
): number {
  if (!unitsComparable(requestUnit, listingUnit)) {
    return 0;
  }
  return quantity;
}

function sameGroup(
  current: { produceId: string; quantity: number }[],
  next: { produceId: string; quantity: number }[],
): boolean {
  const key = (rows: { produceId: string; quantity: number }[]) =>
    rows
      .map((row) => `${row.produceId}:${row.quantity}`)
      .sort()
      .join('|');
  return key(current) === key(next);
}

function searchWhere(search?: string): Prisma.SourcingRequestWhereInput {
  const tokens = search?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return {};
  }
  return {
    AND: tokens.map((token) => ({
      OR: [
        { requestNumber: { contains: token, mode: 'insensitive' as const } },
        { produceName: { contains: token, mode: 'insensitive' as const } },
        {
          buyer: { legalName: { contains: token, mode: 'insensitive' as const } },
        },
        {
          buyer: {
            user: { firstName: { contains: token, mode: 'insensitive' as const } },
          },
        },
        {
          buyer: {
            user: { lastName: { contains: token, mode: 'insensitive' as const } },
          },
        },
      ],
    })),
  };
}

function allocationRow(
  produce: Prisma.ProduceGetPayload<{ include: typeof LISTING_INCLUDE }>,
  selectedQuantity?: number,
) {
  return {
    produceId: produce.id,
    name: produce.name,
    unit: produce.unit,
    pricePerUnit: produce.pricePerUnit.toFixed(2),
    farmCode: produce.farm.farmCode,
    farmName: produce.farm.name,
    farmerName: fullName(produce.farm.owner.user),
    floatingQuantity: produce.floatingQuantity,
    ...(selectedQuantity === undefined ? {} : { selectedQuantity }),
  };
}
