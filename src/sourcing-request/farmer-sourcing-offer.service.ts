import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Prisma,
  SourcingOfferStatus,
  SourcingRequestStatus,
  type Farmer,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { advisoryLock } from '../common/advisory-lock';
import { paginationMeta, resolvePagination } from '../common/pagination';
import type { PaginationQueryDto } from '../common/pagination';
import { requireFarmer } from '../farm/utils/require-farmer';
import { PrismaService } from '../prisma/prisma.service';
import type { FarmerSourcingOfferDto, RejectSourcingOfferDto } from './dto';
import { listingUnitWord } from './utils/sourcing-rules';

const OFFER_INCLUDE = {
  sourcingRequest: {
    select: {
      requestNumber: true,
      produceName: true,
      requiredDate: true,
      deliveryDestination: true,
      status: true,
    },
  },
} satisfies Prisma.SourcingAllocationInclude;

type OfferRow = Prisma.SourcingAllocationGetPayload<{
  include: typeof OFFER_INCLUDE;
}>;

@Injectable()
export class FarmerSourcingOfferService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(user: User, query: PaginationQueryDto) {
    const farmer = await requireFarmer(this.database, user);
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = ownedBy(farmer);
    const [rows, total] = await this.database.$transaction([
      this.database.sourcingAllocation.findMany({
        where,
        include: OFFER_INCLUDE,
        orderBy: [{ sourcingRequest: { createdAt: 'desc' } }, { id: 'desc' }],
        skip,
        take,
      }),
      this.database.sourcingAllocation.count({ where }),
    ]);
    return {
      data: rows.map(formatOffer),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  accept(user: User, offerId: string): Promise<void> {
    return this.respond(user, offerId, SourcingOfferStatus.ACCEPTED, null);
  }

  reject(
    user: User,
    offerId: string,
    dto: RejectSourcingOfferDto,
  ): Promise<void> {
    return this.respond(
      user,
      offerId,
      SourcingOfferStatus.REJECTED,
      dto.reason ?? null,
    );
  }

  private async respond(
    user: User,
    offerId: string,
    outcome: SourcingOfferStatus,
    reason: string | null,
  ): Promise<void> {
    const farmer = await requireFarmer(this.database, user);
    // The lock is keyed by the request, which only the offer row tells us.
    const found = await this.findOwned(this.database, farmer, offerId);
    await this.database.$transaction(async (tx) => {
      await advisoryLock(tx, `sourcing:${found.sourcingRequestId}`);
      // The agent may have changed or deleted the offer while we waited.
      const offer = await this.findOwned(tx, farmer, offerId);
      const request = await tx.sourcingRequest.findUnique({
        where: { id: offer.sourcingRequestId },
        select: { status: true },
      });
      if (request?.status !== SourcingRequestStatus.FINDING_SUPPLY) {
        throw new ConflictException({
          message: 'This offer can no longer be answered',
          code: 'SOURCING_OFFER_CLOSED',
        });
      }
      if (
        outcome === SourcingOfferStatus.ACCEPTED &&
        offer.status === SourcingOfferStatus.ACCEPTED
      ) {
        return;
      }
      await tx.sourcingAllocation.update({
        where: { id: offerId },
        data: {
          status: outcome,
          respondedAt: new Date(),
          rejectReason: reason,
        },
      });
      const accepted = outcome === SourcingOfferStatus.ACCEPTED;
      await this.audit.record(tx, {
        actorType: AuditActorType.FARMER,
        actorUserId: user.id,
        farmerId: farmer.id,
        agentId: null,
        farmId: offer.farmId,
        category: AuditCategory.MATCHING,
        title: accepted ? 'Offer accepted' : 'Offer rejected',
        summary: `${offer.quantity} ${listingUnitWord(offer.unit)} of ${offer.sourcingRequest.produceName}`,
        actionLabel: 'View request',
        resource: AuditResource.SOURCING_REQUEST,
        resourceId: offer.sourcingRequestId,
        sourcingRequestId: offer.sourcingRequestId,
      });
    });
  }

  private async findOwned(
    client: Prisma.TransactionClient | PrismaService,
    farmer: Farmer,
    offerId: string,
  ) {
    const offer = await client.sourcingAllocation.findFirst({
      where: { id: offerId, ...ownedBy(farmer) },
      include: OFFER_INCLUDE,
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }
}

function ownedBy(farmer: Farmer): Prisma.SourcingAllocationWhereInput {
  return { farm: { ownerId: farmer.id } };
}

function formatOffer(row: OfferRow): FarmerSourcingOfferDto {
  return {
    id: row.id,
    status: row.status,
    quantity: row.quantity,
    unit: row.unit,
    agreedUnitPrice: row.agreedUnitPrice?.toFixed(2) ?? null,
    produceName: row.sourcingRequest.produceName,
    requestNumber: row.sourcingRequest.requestNumber,
    requiredDate: row.sourcingRequest.requiredDate,
    deliveryDestination: row.sourcingRequest.deliveryDestination,
    requestStatus: row.sourcingRequest.status,
  };
}
