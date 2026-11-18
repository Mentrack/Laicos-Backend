import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AuditActorType,
  Prisma,
  ProduceStatus,
  ProduceType,
  SourcingOfferStatus,
  type Produce,
  type SourcingContract,
} from '../../../generated/client';
import type { AuditActor } from '../../audit/audit.service';
import type { DeliverySnapshot } from '../../cart/utils/place-checkout';
import { lagosToday } from '../../common/dates';
import { fullName } from '../../common/names';
import type { ConfirmSourcingDto, SourcingContractTermsDto } from '../dto';
import { listingUnitWord } from './sourcing-rules';

export function isFullySigned(contract: {
  buyerSignedAt: Date | null;
  agentSignedAt: Date | null;
}): boolean {
  return contract.buyerSignedAt !== null && contract.agentSignedAt !== null;
}

/** Voided contracts are kept as history; a request has at most one live one. */
export async function voidLiveContract(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  await tx.sourcingContract.updateMany({
    where: { sourcingRequestId: requestId, voidedAt: null },
    data: { voidedAt: new Date() },
  });
}

export type ContractParty = { role: 'AGENT' | 'BUYER'; userId: string };

const PARTY_NAME = {
  select: { firstName: true, lastName: true },
} satisfies Prisma.UserDefaultArgs;

export const CONTRACT_REQUEST_INCLUDE = {
  buyer: { select: { userId: true, buyerId: true, user: PARTY_NAME } },
  assignedAgent: {
    select: { id: true, userId: true, agentId: true, user: PARTY_NAME },
  },
  deliveryState: { select: { name: true } },
  deliveryLga: { select: { name: true } },
} satisfies Prisma.SourcingRequestInclude;

const OFFER_INCLUDE = {
  farm: {
    select: {
      farmCode: true,
      verificationStatus: true,
      owner: { select: { user: PARTY_NAME } },
    },
  },
} satisfies Prisma.SourcingAllocationInclude;

export type ContractRequest = Prisma.SourcingRequestGetPayload<{
  include: typeof CONTRACT_REQUEST_INCLUDE;
}>;
export type ContractAgent = NonNullable<ContractRequest['assignedAgent']>;
export type OfferRow = Prisma.SourcingAllocationGetPayload<{
  include: typeof OFFER_INCLUDE;
}>;
type PricedOffer = {
  row: OfferRow;
  quantity: number;
  agreedUnitPrice: Prisma.Decimal;
};

export function checkWindow(dto: ConfirmSourcingDto): void {
  if (dto.deliveryFrom < lagosToday()) {
    throw new BadRequestException({
      message: 'The delivery window cannot start in the past',
      code: 'INVALID_DELIVERY_WINDOW',
    });
  }
  if (dto.deliveryTo < dto.deliveryFrom) {
    throw new BadRequestException({
      message: 'The delivery window must end on or after its start',
      code: 'INVALID_DELIVERY_WINDOW',
    });
  }
}

export function acceptedOffers(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<OfferRow[]> {
  return tx.sourcingAllocation.findMany({
    where: {
      sourcingRequestId: requestId,
      status: SourcingOfferStatus.ACCEPTED,
    },
    include: OFFER_INCLUDE,
    orderBy: { id: 'asc' },
  });
}

export function pricedOffers(rows: OfferRow[]): PricedOffer[] {
  return rows.map((row) => {
    if (!row.agreedUnitPrice) {
      throw new ConflictException({
        message: 'Every accepted offer needs an agreed price',
        code: 'SOURCING_UNPRICED',
      });
    }
    return {
      row,
      quantity: row.quantity,
      agreedUnitPrice: row.agreedUnitPrice,
    };
  });
}

// Admins cannot unassign past FINDING_SUPPLY, so a negotiated request has one.
export function agentOf(request: ContractRequest): ContractAgent {
  if (!request.assignedAgent) {
    throw new ConflictException({
      message: 'No agent is assigned to this request',
      code: 'SOURCING_NOT_ASSIGNED',
    });
  }
  return request.assignedAgent;
}

export function signedBy(
  contract: SourcingContract,
  party: ContractParty,
): boolean {
  return (
    (party.role === 'BUYER'
      ? contract.buyerSignedAt
      : contract.agentSignedAt) !== null
  );
}

export function auditActor(party: ContractParty | null): AuditActor {
  if (!party) {
    return { type: AuditActorType.SYSTEM, userId: null };
  }
  return {
    type:
      party.role === 'BUYER'
        ? AuditActorType.BUYER
        : AuditActorType.EXTENSION_AGENT,
    userId: party.userId,
  };
}

export function contractTerms(
  request: ContractRequest,
  agent: ContractAgent,
  dto: ConfirmSourcingDto,
  place: { state: string | null; lga: string | null },
  offers: PricedOffer[],
  agreed: Prisma.Decimal,
) {
  return {
    requestNumber: request.requestNumber,
    buyer: { name: fullName(request.buyer.user), code: request.buyer.buyerId },
    agent: { name: fullName(agent.user), code: agent.agentId },
    produceName: request.produceName,
    quantity: request.quantity,
    unit: request.unit,
    agreedPrice: agreed.toFixed(2),
    delivery: {
      country: dto.deliveryCountry,
      address: dto.deliveryAddress,
      region: dto.deliveryRegion ?? null,
      state: place.state,
      lga: place.lga,
      contactName: dto.deliveryContactName ?? null,
      contactPhone: dto.deliveryContactPhone ?? null,
      from: dto.deliveryFrom,
      to: dto.deliveryTo,
    },
    lines: offers.map(({ row, quantity, agreedUnitPrice }) => ({
      farmCode: row.farm.farmCode,
      farmerName: fullName(row.farm.owner.user),
      produceName: request.produceName,
      quantity,
      unit: row.unit,
      agreedUnitPrice: agreedUnitPrice.toFixed(2),
    })),
  } satisfies SourcingContractTermsDto;
}

/**
 * The hidden listing a sourced order points at, so the order, handover,
 * payout and dispute code run unchanged without touching the farm's real
 * stock. It is born with its whole quantity already held by that order, as a
 * placed order leaves a listing, so confirm and release need no special case.
 */
export async function createSourcedListing(
  tx: Prisma.TransactionClient,
  produceName: string,
  offer: PricedOffer,
): Promise<Produce> {
  const { row, quantity, agreedUnitPrice } = offer;
  const listing = await tx.produce.create({
    data: {
      farmId: row.farmId,
      name: produceName,
      unit: listingUnitWord(row.unit),
      quantity,
      actualQuantity: quantity,
      floatingQuantity: 0,
      pricePerUnit: agreedUnitPrice,
      status: ProduceStatus.SOURCED,
      type: ProduceType.LOCAL,
    },
  });
  await tx.sourcingAllocation.update({
    where: { id: row.id },
    data: { produceId: listing.id },
  });
  return listing;
}

export function deliverySnapshot(request: ContractRequest): DeliverySnapshot {
  const { deliveryCountry, deliveryAddress, deliveryFrom } = request;
  // confirm writes these before the request can be CONFIRMED.
  if (!deliveryCountry || !deliveryAddress || !deliveryFrom) {
    throw new Error(
      `Sourcing request ${request.id} is CONFIRMED without delivery details`,
    );
  }
  return {
    deliveryDate: deliveryFrom,
    deliveryLabel: 'Sourcing delivery',
    deliveryStreet: deliveryAddress,
    deliveryState: request.deliveryState?.name ?? null,
    deliveryLga: request.deliveryLga?.name ?? null,
    deliveryCountry,
    deliveryDateTo: request.deliveryTo,
    deliveryContactName: request.deliveryContactName,
    deliveryContactPhone: request.deliveryContactPhone,
  };
}
