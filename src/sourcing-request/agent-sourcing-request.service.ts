import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  NotificationType,
  Prisma,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
  type Agent,
  type SourcingRequest,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { advisoryLock } from '../common/advisory-lock';
import { paginationMeta, resolvePagination } from '../common/pagination';
import type { PaginationQueryDto } from '../common/pagination';
import { searchTokens } from '../common/search';
import { openSourcingConversation } from '../conversation/utils/sourcing-conversation';
import { NotificationService } from '../notifications/notification.service';
import { CheckoutConfig } from '../payment/checkout-config';
import { notSourced } from '../produce/utils/produce-visibility';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AgentFarmQueryDto,
  DeclineSourcingRequestDto,
  PriceSourcingOfferDto,
  SetSourcingOffersDto,
  SourcingOfferLineDto,
  SourcingQuoteDto,
} from './dto';
import {
  AGENT_REQUEST_INCLUDE,
  agentFarmInclude,
  formatAgentFarm,
  formatAgentSourcingRequest,
} from './formatters/agent-sourcing-request.formatter';
import { SourcingConfig } from './sourcing-config';
import { isFullySigned, voidLiveContract } from './utils/sourcing-contract';
import { returnToPending } from './utils/sourcing-decline';
import { assertCovered, quote as priceQuote } from './utils/sourcing-pricing';
import {
  listingUnitWord,
  requireVerifiedFarms,
  unitsComparable,
} from './utils/sourcing-rules';
import { moveSourcingStatus } from './utils/sourcing-transitions';

// What offer checks, notifications and audit rows need about a farm.
const OFFER_FARM_SELECT = {
  id: true,
  farmCode: true,
  verificationStatus: true,
  owner: { select: { userId: true } },
} satisfies Prisma.FarmSelect;

const OFFER_INCLUDE = {
  farm: { select: OFFER_FARM_SELECT },
} satisfies Prisma.SourcingAllocationInclude;

type OfferFarm = Prisma.FarmGetPayload<{ select: typeof OFFER_FARM_SELECT }>;
type OfferRow = Prisma.SourcingAllocationGetPayload<{
  include: typeof OFFER_INCLUDE;
}>;

type AgentAudit = {
  category: AuditCategory;
  title: string;
  summary: string;
  farmId?: string;
};

@Injectable()
export class AgentSourcingRequestService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: SourcingConfig,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly checkout: CheckoutConfig,
  ) {}

  async findAll(agent: Agent, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = { assignedAgentId: agent.id };
    const [rows, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        include: AGENT_REQUEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      data: rows.map((row) =>
        formatAgentSourcingRequest(row, this.config.responseHours),
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(agent: Agent, id: string) {
    const request = await this.database.sourcingRequest.findFirst({
      where: { id, assignedAgentId: agent.id },
      include: AGENT_REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    return formatAgentSourcingRequest(request, this.config.responseHours);
  }

  async accept(agent: Agent, id: string) {
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      await moveSourcingStatus(
        tx,
        id,
        SourcingRequestStatus.FINDING_SUPPLY,
        'AGENT',
      );
      await openSourcingConversation(tx, request, agent.userId);
      await this.record(tx, agent, id, {
        category: AuditCategory.SOURCING,
        title: 'Request accepted',
        summary: request.requestNumber,
      });
    });
    return this.findOne(agent, id);
  }

  async decline(agent: Agent, id: string, dto: DeclineSourcingRequestDto) {
    const deliveryIds = await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      return returnToPending(
        tx,
        {
          notifications: this.notifications,
          audit: this.audit,
          responseHours: this.config.responseHours,
        },
        request,
        dto.reason,
        agent.userId,
      );
    });
    void this.notifications.dispatch(deliveryIds);
  }

  async farms(agent: Agent, id: string, query: AgentFarmQueryDto) {
    const request = await this.requireOwn(this.database, agent, id);
    requireFindingSupply(request);
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = farmWhere(request, query);
    const [rows, total] = await this.database.$transaction([
      this.database.farm.findMany({
        where,
        include: agentFarmInclude(id),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.database.farm.count({ where }),
    ]);
    return {
      data: rows.map(formatAgentFarm),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async setOffers(agent: Agent, id: string, dto: SetSourcingOffersDto) {
    const deliveryIds = await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      requireFindingSupply(request);
      requireComparableUnits(request, dto.offers);
      const current = await tx.sourcingAllocation.findMany({
        where: { sourcingRequestId: id },
        include: OFFER_INCLUDE,
      });
      const byFarm = new Map(current.map((row) => [row.farmId, row]));
      // Unchanged offers are not re-checked; confirm re-checks verification.
      const changed = dto.offers.filter((line) => {
        const existing = byFarm.get(line.farmId);
        return (
          !existing ||
          existing.quantity !== line.quantity ||
          existing.unit !== line.unit
        );
      });
      const lines = await offeredFarms(tx, changed);
      const kept = new Set(dto.offers.map((line) => line.farmId));
      const removed = current.filter((row) => !kept.has(row.farmId));
      const ids = await this.withdraw(tx, agent, request, removed);
      for (const { line, farm } of lines) {
        ids.push(
          ...(await this.offer(
            tx,
            agent,
            request,
            line,
            farm,
            byFarm.get(line.farmId),
          )),
        );
      }
      return ids;
    });
    void this.notifications.dispatch(deliveryIds);
    return this.findOne(agent, id);
  }

  async setOfferPrice(
    agent: Agent,
    id: string,
    offerId: string,
    dto: PriceSourcingOfferDto,
  ) {
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      requireFindingSupply(request);
      const offer = await tx.sourcingAllocation.findFirst({
        where: { id: offerId, sourcingRequestId: id },
        include: OFFER_INCLUDE,
      });
      if (!offer) {
        throw new NotFoundException('Offer not found');
      }
      const price = new Prisma.Decimal(dto.agreedUnitPrice);
      await tx.sourcingAllocation.update({
        where: { id: offerId },
        data: { agreedUnitPrice: price },
      });
      await this.record(tx, agent, id, {
        farmId: offer.farmId,
        category: AuditCategory.MATCHING,
        title: 'Offer priced',
        summary: `${request.produceName} at ${price.toFixed(2)} per ${listingUnitWord(offer.unit)} (${offer.farm.farmCode})`,
      });
    });
    return this.findOne(agent, id);
  }

  async supplyComplete(agent: Agent, id: string) {
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      requireFindingSupply(request);
      const accepted = onlyAccepted(
        await tx.sourcingAllocation.findMany({
          where: { sourcingRequestId: id },
          include: OFFER_INCLUDE,
        }),
      );
      assertCovered(request, accepted);
      if (accepted.some((row) => row.agreedUnitPrice === null)) {
        throw new ConflictException({
          message: 'Every accepted offer needs an agreed price',
          code: 'SOURCING_UNPRICED',
        });
      }
      await moveSourcingStatus(
        tx,
        id,
        SourcingRequestStatus.NEGOTIATING,
        'AGENT',
      );
      await this.record(tx, agent, id, {
        category: AuditCategory.SOURCING,
        title: 'Supply complete',
        summary: `${accepted.length} accepted offer(s)`,
      });
    });
    return this.findOne(agent, id);
  }

  async back(agent: Agent, id: string) {
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${id}`);
      const request = await this.requireOwn(tx, agent, id);
      const fromConfirmed = request.status === SourcingRequestStatus.CONFIRMED;
      if (fromConfirmed) {
        const live = await tx.sourcingContract.findFirst({
          where: { sourcingRequestId: id, voidedAt: null },
        });
        if (live && isFullySigned(live)) {
          throw new ConflictException({
            message: 'Both parties have signed the contract',
            code: 'SOURCING_CONTRACT_SIGNED',
          });
        }
        await voidLiveContract(tx, id);
      }
      // Anything other than NEGOTIATING or CONFIRMED is refused here.
      await moveSourcingStatus(
        tx,
        id,
        fromConfirmed
          ? SourcingRequestStatus.NEGOTIATING
          : SourcingRequestStatus.FINDING_SUPPLY,
        'AGENT',
      );
      await this.record(tx, agent, id, {
        category: AuditCategory.SOURCING,
        title: fromConfirmed ? 'Contract withdrawn' : 'Back to finding supply',
        summary: request.requestNumber,
      });
    });
    return this.findOne(agent, id);
  }

  async quote(agent: Agent, id: string): Promise<SourcingQuoteDto> {
    const request = await this.requireOwn(this.database, agent, id);
    const accepted = onlyAccepted(
      await this.database.sourcingAllocation.findMany({
        where: { sourcingRequestId: id },
        include: OFFER_INCLUDE,
        orderBy: { id: 'asc' },
      }),
    );
    const priced = accepted.flatMap((row) =>
      row.agreedUnitPrice
        ? [{ row, agreedUnitPrice: row.agreedUnitPrice }]
        : [],
    );
    const figures = priceQuote(
      priced.map(({ row, agreedUnitPrice }) => ({
        quantity: row.quantity,
        agreedUnitPrice,
      })),
      this.checkout,
    );
    return {
      lines: priced.map(({ row, agreedUnitPrice }, index) => ({
        offerId: row.id,
        produceName: request.produceName,
        farmCode: row.farm.farmCode,
        quantity: row.quantity,
        unit: row.unit,
        agreedUnitPrice: agreedUnitPrice.toFixed(2),
        total: agreedUnitPrice.mul(row.quantity).toFixed(2),
        commission: figures.commissions[index].toFixed(2),
      })),
      unpricedOffers: accepted.length - priced.length,
      subtotal: figures.subtotal.toFixed(2),
      serviceFee: figures.serviceFee.toFixed(2),
      agentCommission: figures.agentCommission.toFixed(2),
      suggestedPrice: figures.suggestedPrice.toFixed(2),
    };
  }

  // A rejected farmer has already walked away, so only live offers are told.
  private async withdraw(
    tx: Prisma.TransactionClient,
    agent: Agent,
    request: SourcingRequest,
    removed: OfferRow[],
  ): Promise<string[]> {
    if (removed.length === 0) {
      return [];
    }
    await tx.sourcingAllocation.deleteMany({
      where: { id: { in: removed.map((row) => row.id) } },
    });
    const ids: string[] = [];
    for (const row of removed) {
      if (row.status !== SourcingOfferStatus.REJECTED) {
        ids.push(
          ...(await this.notifications.notify(
            {
              userIds: [row.farm.owner.userId],
              type: NotificationType.SOURCING_OFFER_WITHDRAWN,
              params: {
                requestId: request.id,
                offerId: row.id,
                produceName: request.produceName,
              },
            },
            tx,
          )),
        );
      }
      await this.record(tx, agent, request.id, {
        farmId: row.farmId,
        category: AuditCategory.MATCHING,
        title: 'Offer withdrawn',
        summary: offerSummary(request, row, row.farm),
      });
    }
    return ids;
  }

  // New and changed offers go (back) to the farmer for agreement.
  private async offer(
    tx: Prisma.TransactionClient,
    agent: Agent,
    request: SourcingRequest,
    line: SourcingOfferLineDto,
    farm: OfferFarm,
    existing: OfferRow | undefined,
  ): Promise<string[]> {
    let offerId: string;
    if (existing) {
      offerId = existing.id;
      await tx.sourcingAllocation.update({
        where: { id: offerId },
        data: {
          quantity: line.quantity,
          unit: line.unit,
          status: SourcingOfferStatus.OFFERED,
          respondedAt: null,
          rejectReason: null,
          // The agreed price is per unit, so a new unit voids it.
          ...(line.unit !== existing.unit ? { agreedUnitPrice: null } : {}),
        },
      });
    } else {
      const created = await tx.sourcingAllocation.create({
        data: {
          sourcingRequestId: request.id,
          farmId: line.farmId,
          quantity: line.quantity,
          unit: line.unit,
        },
      });
      offerId = created.id;
    }
    await this.record(tx, agent, request.id, {
      farmId: farm.id,
      category: AuditCategory.MATCHING,
      title: existing ? 'Offer changed' : 'Offer made',
      summary: offerSummary(request, line, farm),
    });
    return this.notifications.notify(
      {
        userIds: [farm.owner.userId],
        type: NotificationType.SOURCING_OFFER,
        params: {
          requestId: request.id,
          offerId,
          produceName: request.produceName,
          quantity: String(line.quantity),
          unit: listingUnitWord(line.unit),
        },
      },
      tx,
    );
  }

  private async record(
    tx: Prisma.TransactionClient,
    agent: Agent,
    requestId: string,
    event: AgentAudit,
  ): Promise<void> {
    await this.audit.record(tx, {
      actorType: AuditActorType.EXTENSION_AGENT,
      actorUserId: agent.userId,
      // AuditEvent_actor_check: an agent row must not name a farmer.
      farmerId: null,
      agentId: agent.id,
      farmId: event.farmId ?? null,
      category: event.category,
      title: event.title,
      summary: event.summary,
      actionLabel: 'View request',
      resource: AuditResource.SOURCING_REQUEST,
      resourceId: requestId,
      sourcingRequestId: requestId,
    });
  }

  // Under the lock, so a concurrent reassignment can't slip past the check.
  private async requireOwn(
    tx: Prisma.TransactionClient,
    agent: Agent,
    id: string,
  ) {
    const request = await tx.sourcingRequest.findUnique({
      where: { id },
      include: { buyer: { select: { userId: true } } },
    });
    if (!request || request.assignedAgentId !== agent.id) {
      throw new NotFoundException('Sourcing request not found');
    }
    return request;
  }
}

function requireFindingSupply(request: SourcingRequest): void {
  if (request.status !== SourcingRequestStatus.FINDING_SUPPLY) {
    throw new ConflictException({
      message: 'The supply pool can change only while finding supply',
      code: 'SOURCING_NOT_FINDING_SUPPLY',
    });
  }
}

// A search replaces the default crop filter, so the agent can look up a farm
// or farmer directly. Each search word must match somewhere. Stock plays no
// part: a farm often grows more than it lists.
function farmWhere(
  request: SourcingRequest,
  query: AgentFarmQueryDto,
): Prisma.FarmWhereInput {
  const like = (value: string) => ({
    contains: value,
    mode: 'insensitive' as const,
  });
  const listingNamed = (value: string) => ({
    produce: { some: { ...notSourced, name: like(value) } },
  });
  const tokens = searchTokens(query.search);
  const crop = request.produceName.trim();
  return {
    verificationStatus: FarmVerificationStatus.VERIFIED,
    ...(query.stateId ? { stateId: query.stateId } : {}),
    ...(query.lgaId ? { lgaId: query.lgaId } : {}),
    ...(tokens.length === 0
      ? { OR: [{ mainProduce: like(crop) }, listingNamed(crop)] }
      : {
          AND: tokens.map((token) => ({
            OR: [
              { name: like(token) },
              { farmCode: like(token) },
              { owner: { farmerId: like(token) } },
              { owner: { user: { firstName: like(token) } } },
              { owner: { user: { lastName: like(token) } } },
              { mainProduce: like(token) },
              listingNamed(token),
            ],
          })),
        }),
  };
}

function requireComparableUnits(
  request: SourcingRequest,
  offers: SourcingOfferLineDto[],
): void {
  const odd = offers.find((line) => !unitsComparable(request.unit, line.unit));
  if (odd) {
    throw new BadRequestException({
      message: `An offer in ${listingUnitWord(odd.unit)} cannot count towards a request in ${listingUnitWord(request.unit)}`,
      code: 'SOURCING_UNIT_MISMATCH',
    });
  }
}

async function offeredFarms(
  tx: Prisma.TransactionClient,
  offers: SourcingOfferLineDto[],
): Promise<{ line: SourcingOfferLineDto; farm: OfferFarm }[]> {
  if (offers.length === 0) {
    return [];
  }
  const farms = await tx.farm.findMany({
    where: { id: { in: offers.map((line) => line.farmId) } },
    select: OFFER_FARM_SELECT,
  });
  const byId = new Map(farms.map((farm) => [farm.id, farm]));
  const lines = offers.map((line) => {
    const farm = byId.get(line.farmId);
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    return { line, farm };
  });
  requireVerifiedFarms(farms);
  return lines;
}

// Pending and rejected offers play no part in coverage or price.
function onlyAccepted(rows: OfferRow[]): OfferRow[] {
  return rows.filter((row) => row.status === SourcingOfferStatus.ACCEPTED);
}

function offerSummary(
  request: SourcingRequest,
  offer: { quantity: number; unit: SourcingUnit },
  farm: OfferFarm,
): string {
  return `${offer.quantity} ${listingUnitWord(offer.unit)} of ${request.produceName} (${farm.farmCode})`;
}
