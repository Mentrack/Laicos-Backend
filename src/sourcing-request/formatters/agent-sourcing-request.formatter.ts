import type { Prisma } from '../../../generated/client';
import { SourcingRequestStatus } from '../../../generated/client';
import { fromDateColumn } from '../../common/dates';
import { fullName } from '../../common/names';
import { ON_SALE_STATUSES } from '../../produce/utils/produce-visibility';
import type { AgentSourcingRequestDto, SourcingFarmRowDto } from '../dto';
import { contractFields } from './sourcing-contract.formatter';

export const AGENT_REQUEST_INCLUDE = {
  allocations: {
    include: { farm: { select: { farmCode: true, name: true } } },
    orderBy: { id: 'asc' },
  },
  conversation: { select: { id: true } },
  contracts: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.SourcingRequestInclude;

type AgentRequestRow = Prisma.SourcingRequestGetPayload<{
  include: typeof AGENT_REQUEST_INCLUDE;
}>;

export function formatAgentSourcingRequest(
  request: AgentRequestRow,
  responseHours: number,
): AgentSourcingRequestDto {
  const [contract] = request.contracts;
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
    respondBy:
      request.status === SourcingRequestStatus.ASSIGNED && request.assignedAt
        ? new Date(request.assignedAt.getTime() + responseHours * 3_600_000)
        : null,
    conversationId: request.conversation?.id ?? null,
    offers: request.allocations.map((offer) => ({
      id: offer.id,
      farmId: offer.farmId,
      farmCode: offer.farm.farmCode,
      farmName: offer.farm.name,
      quantity: offer.quantity,
      unit: offer.unit,
      status: offer.status,
      agreedUnitPrice: offer.agreedUnitPrice?.toFixed(2) ?? null,
    })),
    contract: contract ? contractFields(contract) : null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

// What the agent sees of a farm: its owner, place, the names it sells under
// and whether this request already offers it something.
export function agentFarmInclude(requestId: string) {
  return {
    state: { select: { name: true } },
    lga: { select: { name: true } },
    owner: {
      select: {
        farmerId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    },
    produce: {
      where: { status: { in: ON_SALE_STATUSES } },
      select: { name: true },
      orderBy: { name: 'asc' },
    },
    sourcingAllocations: {
      where: { sourcingRequestId: requestId },
      select: { id: true },
    },
  } satisfies Prisma.FarmInclude;
}

type AgentFarmRow = Prisma.FarmGetPayload<{
  include: ReturnType<typeof agentFarmInclude>;
}>;

export function formatAgentFarm(farm: AgentFarmRow): SourcingFarmRowDto {
  return {
    farmId: farm.id,
    farmCode: farm.farmCode,
    farmName: farm.name,
    farmerName: fullName(farm.owner.user),
    farmerCode: farm.owner.farmerId,
    state: farm.state.name,
    lga: farm.lga.name,
    mainProduce: farm.mainProduce,
    listingNames: [...new Set(farm.produce.map((listing) => listing.name))],
    offerId: farm.sourcingAllocations[0]?.id ?? null,
  };
}
