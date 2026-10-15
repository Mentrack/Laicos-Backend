import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FarmerStatus,
  FarmVerificationStatus,
  OrderStatus,
  Prisma,
  ProduceStatus,
  VerificationTaskStatus,
} from '../../../generated/client';
import { paginationMeta, resolvePagination } from '../../common/pagination';
import { OPEN_PAID_ORDER_STATUSES } from '../../order/utils/open-paid';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type {
  AdminFarmAgentDto,
  AdminFarmAssignedAgentDto,
  AdminFarmClusterDto,
  AdminFarmDetailDto,
  AdminFarmEvidenceFileDto,
  AdminFarmFarmerDto,
  AdminFarmMarketplaceDto,
  AdminFarmOrderDto,
  AdminFarmProductDto,
  AdminFarmQueryDto,
  AdminFarmRowDto,
  AdminFarmSummaryDto,
  AdminFarmVerificationDto,
  SuspendedFarmerDto,
} from '../dto/admin-farm.dto';
import { FARM_INCLUDE, formatFarm } from '../formatters/farm.formatter';

const RECENT_ORDERS = 5;

/** Placed and not cancelled. Unpaid and cancelled orders are not sales. */
const SALE = {
  notIn: [OrderStatus.CANCELLED, OrderStatus.AWAITING_PAYMENT],
} satisfies Prisma.EnumOrderStatusFilter;

const LIST_INCLUDE = {
  state: true,
  lga: true,
  owner: {
    select: {
      id: true,
      farmerId: true,
      status: true,
      user: { select: { firstName: true, lastName: true, phoneNumber: true } },
    },
  },
} satisfies Prisma.FarmInclude;

const AGENT_SELECT = {
  id: true,
  agentId: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AgentSelect;

const CLUSTER_AGENT_SELECT = {
  ...AGENT_SELECT,
  state: { select: { id: true, name: true } },
  lga: { select: { id: true, stateId: true, name: true } },
} satisfies Prisma.AgentSelect;

const DETAIL_INCLUDE = {
  ...FARM_INCLUDE,
  owner: LIST_INCLUDE.owner,
  produce: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
  cluster: {
    select: {
      id: true,
      name: true,
      _count: { select: { farms: true } },
      agent: { select: CLUSTER_AGENT_SELECT },
    },
  },
  verifications: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    include: {
      evidence: { orderBy: { createdAt: 'asc' as const } },
      agent: { select: AGENT_SELECT },
    },
  },
} satisfies Prisma.FarmInclude;

type DetailedFarm = Prisma.FarmGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type Round = DetailedFarm['verifications'][number];
type AgentPerson = Prisma.AgentGetPayload<{ select: typeof AGENT_SELECT }>;
type ClusterAgent = Prisma.AgentGetPayload<{
  select: typeof CLUSTER_AGENT_SELECT;
}>;

type ListedFarm = Prisma.FarmGetPayload<{ include: typeof LIST_INCLUDE }>;

@Injectable()
export class AdminFarmService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(query: AdminFarmQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = whereFor(query);
    const [farms, total] = await this.database.$transaction([
      this.database.farm.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.database.farm.count({ where }),
    ]);
    return {
      data: farms.map(toRow),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async summary(): Promise<AdminFarmSummaryDto> {
    const [
      totalFarmers,
      states,
      statuses,
      totalFarms,
      participatingFarms,
      activeClusters,
      produceRows,
    ] = await Promise.all([
      this.database.farmer.count(),
      this.database.farm.groupBy({ by: ['stateId'] }),
      this.database.farm.groupBy({
        by: ['verificationStatus'],
        _count: { _all: true },
      }),
      this.database.farm.count(),
      this.database.farm.count({ where: { clusterId: { not: null } } }),
      this.database.cluster.count({ where: { farms: { some: {} } } }),
      // Distinct is case-sensitive in Prisma, and blanks are not a commodity.
      this.database.$queryRaw<{ count: number }[]>`
        SELECT COUNT(DISTINCT lower(btrim("mainProduce")))::int AS count
        FROM "Farm"
        WHERE btrim("mainProduce") <> ''
      `,
    ]);
    const byStatus = {
      [FarmVerificationStatus.PENDING]: 0,
      [FarmVerificationStatus.VERIFIED]: 0,
      [FarmVerificationStatus.REJECTED]: 0,
      [FarmVerificationStatus.SUSPENDED]: 0,
    };
    for (const group of statuses) {
      byStatus[group.verificationStatus] = group._count._all;
    }
    const verifiedFarms = byStatus[FarmVerificationStatus.VERIFIED];
    return {
      totalFarmers,
      stateCount: states.length,
      verifiedFarms,
      verificationRate:
        totalFarms === 0 ? 0 : Math.round((100 * verifiedFarms) / totalFarms),
      awaitingReview: byStatus[FarmVerificationStatus.PENDING],
      suspendedFarms: byStatus[FarmVerificationStatus.SUSPENDED],
      activeClusters,
      participatingFarms,
      produceTypes: Number(produceRows[0]?.count ?? 0),
    };
  }

  async suspend(id: string): Promise<SuspendedFarmerDto> {
    return this.database.$transaction(async (tx) => {
      const farmer = await tx.farmer.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!farmer) {
        throw new NotFoundException('Farmer not found');
      }
      const openPaid = await tx.order.count({
        where: {
          status: { in: OPEN_PAID_ORDER_STATUSES },
          farm: { ownerId: id },
        },
      });
      if (openPaid > 0) {
        throw new ConflictException('Farmer has open paid orders');
      }
      await tx.farmer.update({
        where: { id },
        data: { status: FarmerStatus.DISABLED },
      });
      const farms = await tx.farm.updateMany({
        where: { ownerId: id },
        data: { verificationStatus: FarmVerificationStatus.SUSPENDED },
      });
      return {
        id,
        status: FarmerStatus.DISABLED,
        farmsSuspended: farms.count,
      };
    });
  }

  async findOne(id: string): Promise<AdminFarmDetailDto> {
    const farm = await this.database.farm.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    const [formatted, marketplace, verifications] = await Promise.all([
      formatFarm(this.storage, farm),
      this.marketplace(id, farm.produce),
      Promise.all(farm.verifications.map((round) => this.verification(round))),
    ]);
    return {
      ...formatted,
      farmer: toFarmer(farm.owner),
      marketplace,
      verifications,
      cluster: toCluster(farm.cluster),
      evidence: evidenceFiles(verifications),
      assignedAgent: farm.cluster
        ? toAssignedAgent(
            farm.cluster.agent,
            farm.cluster._count.farms,
            farm.verifications,
          )
        : null,
    };
  }

  private async marketplace(
    farmId: string,
    produce: DetailedFarm['produce'],
  ): Promise<AdminFarmMarketplaceDto> {
    const sold = { farmId, status: SALE };
    const [sum, completedOrders, recent] = await this.database.$transaction([
      this.database.order.aggregate({ where: sold, _sum: { quantity: true } }),
      this.database.order.count({
        where: { farmId, status: OrderStatus.FULFILLED },
      }),
      this.database.order.findMany({
        where: sold,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_ORDERS,
        select: {
          id: true,
          orderNumber: true,
          produceName: true,
          quantity: true,
          status: true,
          produce: { select: { unit: true } },
        },
      }),
    ]);
    return {
      products: produce.map(toProduct),
      activeProducts: produce.filter(
        (item) => item.status === ProduceStatus.PUBLISHED,
      ).length,
      completedOrders,
      totalSold: sum._sum.quantity ?? 0,
      recentOrders: recent.map(toOrder),
    };
  }

  private async verification(round: Round): Promise<AdminFarmVerificationDto> {
    const [
      locationEvidenceUrl,
      productionEvidenceUrl,
      farmPlotSketchUrl,
      harvestEstimateUrl,
    ] = await Promise.all([
      this.storage.presignedUrlOrNull(round.locationEvidenceKey),
      this.storage.presignedUrlOrNull(round.productionEvidenceKey),
      this.storage.presignedUrlOrNull(round.farmPlotSketchKey),
      this.storage.presignedUrlOrNull(round.harvestEstimateKey),
    ]);
    return {
      id: round.id,
      status: round.status,
      createdAt: round.createdAt,
      decidedAt: round.decidedAt,
      note: roundNote(round),
      evidenceStatus: round.evidenceStatus,
      informationRequestNote: round.informationRequestNote ?? null,
      informationRequestedAt: round.informationRequestedAt ?? null,
      documents: {
        locationEvidenceUrl,
        productionEvidenceUrl,
        farmPlotSketchUrl,
        harvestEstimateUrl,
      },
      agent: round.agent ? toAgent(round.agent) : null,
      evidence: await Promise.all(
        round.evidence.map(async (item) => ({
          id: item.id,
          kind: item.kind,
          checkKey: item.checkKey,
          photoSlot: item.photoSlot,
          url: await this.storage.getPresignedUrl(item.storageKey),
          createdAt: item.createdAt,
        })),
      ),
    };
  }
}

function whereFor(query: AdminFarmQueryDto): Prisma.FarmWhereInput {
  const search = query.search?.trim();
  const contains: Prisma.StringFilter = {
    contains: search ?? '',
    mode: 'insensitive',
  };
  return {
    stateId: query.stateId,
    verificationStatus: query.status,
    OR: search
      ? [
          { name: contains },
          { farmCode: contains },
          { owner: { farmerId: contains } },
          { owner: { user: { firstName: contains } } },
          { owner: { user: { lastName: contains } } },
          { owner: { user: { phoneNumber: contains } } },
        ]
      : undefined,
  };
}

function toRow(farm: ListedFarm): AdminFarmRowDto {
  return {
    id: farm.id,
    farmCode: farm.farmCode,
    name: farm.name,
    size: farm.size,
    unit: farm.unit,
    mainProduce: farm.mainProduce,
    verificationStatus: farm.verificationStatus,
    state: { id: farm.state.id, name: farm.state.name },
    lga: { id: farm.lga.id, stateId: farm.lga.stateId, name: farm.lga.name },
    farmer: toFarmer(farm.owner),
  };
}

function toProduct(
  produce: DetailedFarm['produce'][number],
): AdminFarmProductDto {
  return {
    id: produce.id,
    name: produce.name,
    quantity: produce.quantity,
    unit: produce.unit,
    pricePerUnit: produce.pricePerUnit.toFixed(2),
    status: produce.status,
  };
}

function toOrder(
  order: Prisma.OrderGetPayload<{
    select: {
      id: true;
      orderNumber: true;
      produceName: true;
      quantity: true;
      status: true;
      produce: { select: { unit: true } };
    };
  }>,
): AdminFarmOrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    produceName: order.produceName,
    quantity: order.quantity,
    unit: order.produce.unit,
    status: order.status,
  };
}

function toAgent(agent: AgentPerson): AdminFarmAgentDto {
  return {
    id: agent.id,
    agentId: agent.agentId,
    firstName: agent.user.firstName,
    lastName: agent.user.lastName,
  };
}

function toCluster(
  cluster: DetailedFarm['cluster'],
): AdminFarmClusterDto | null {
  if (!cluster) return null;
  return {
    id: cluster.id,
    name: cluster.name,
    farmCount: cluster._count.farms,
  };
}

function toAssignedAgent(
  agent: ClusterAgent,
  farmCount: number,
  rounds: Round[],
): AdminFarmAssignedAgentDto {
  const own = rounds.filter((round) => round.agent?.id === agent.id);
  return {
    ...toAgent(agent),
    state: agent.state,
    lga: agent.lga,
    farmCount,
    visits: own.length,
    lastVisitAt: own.reduce<Date | null>((latest, round) => {
      const at = round.decidedAt ?? round.startedAt ?? round.createdAt;
      return !latest || at > latest ? at : latest;
    }, null),
  };
}

function evidenceFiles(
  rounds: AdminFarmVerificationDto[],
): AdminFarmEvidenceFileDto[] {
  return rounds
    .flatMap((round) =>
      round.evidence.map((item) => ({ ...item, verificationId: round.id })),
    )
    .sort((a, b) => {
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      return byDate === 0 ? b.id.localeCompare(a.id) : byDate;
    });
}

function roundNote(
  round: Pick<Round, 'status' | 'generalNote' | 'rejectionReason'>,
) {
  if (round.status === VerificationTaskStatus.REJECTED) {
    return round.rejectionReason ?? round.generalNote;
  }
  return round.generalNote;
}

function toFarmer(owner: ListedFarm['owner']): AdminFarmFarmerDto {
  return {
    id: owner.id,
    farmerId: owner.farmerId,
    firstName: owner.user.firstName,
    lastName: owner.user.lastName,
    phoneNumber: owner.user.phoneNumber,
    status: owner.status,
  };
}
