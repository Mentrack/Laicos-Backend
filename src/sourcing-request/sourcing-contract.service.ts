import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  NotificationType,
  Prisma,
  SourcingRequestStatus,
  type Agent,
  type SourcingContract,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { createCheckout, findReplay } from '../cart/utils/place-checkout';
import { advisoryLock } from '../common/advisory-lock';
import { toDateColumn } from '../common/dates';
import { LocationService } from '../location/location.service';
import { NotificationService } from '../notifications/notification.service';
import { orderLine, type OrderLine } from '../order/utils/reservation';
import { CheckoutConfig } from '../payment/checkout-config';
import {
  busyAsConflict,
  CHECKOUT_TRANSACTION,
} from '../payment/utils/checkout-transaction';
import { PrismaService } from '../prisma/prisma.service';
import type { ConfirmSourcingDto, SourcingContractDto } from './dto';
import { formatSourcingContract } from './formatters/sourcing-contract.formatter';
import { SourcingConfig } from './sourcing-config';
import {
  acceptedOffers,
  agentOf,
  auditActor,
  checkWindow,
  CONTRACT_REQUEST_INCLUDE,
  contractTerms,
  createSourcedListing,
  deliverySnapshot,
  isFullySigned,
  pricedOffers,
  signedBy,
  type ContractParty,
  type ContractRequest,
} from './utils/sourcing-contract';
import {
  assertAgreedPrice,
  assertCovered,
  quote,
  sourcedFigures,
} from './utils/sourcing-pricing';
import { requireVerifiedFarms } from './utils/sourcing-rules';
import { moveSourcingStatus } from './utils/sourcing-transitions';

type SignOutcome = {
  contract: SourcingContractDto;
  deliveryIds: string[];
};

@Injectable()
export class SourcingContractService {
  constructor(
    private readonly database: PrismaService,
    private readonly checkout: CheckoutConfig,
    private readonly config: SourcingConfig,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
  ) {}

  /** The latest contract, voided or not. */
  async findOne(
    id: string,
    party: ContractParty,
  ): Promise<SourcingContractDto> {
    await this.requireParty(this.database, id, party);
    const contract = await this.database.sourcingContract.findFirst({
      where: { sourcingRequestId: id },
      orderBy: { createdAt: 'desc' },
    });
    if (!contract) {
      throw new NotFoundException('No contract yet');
    }
    return this.present(this.database, contract);
  }

  async confirm(
    agent: Agent,
    id: string,
    dto: ConfirmSourcingDto,
  ): Promise<SourcingContractDto> {
    checkWindow(dto);
    const party: ContractParty = { role: 'AGENT', userId: agent.userId };
    const { contract, deliveryIds } = await this.database.$transaction(
      async (tx) => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireParty(tx, id, party);
        if (request.status !== SourcingRequestStatus.NEGOTIATING) {
          throw new ConflictException({
            message: 'Only a request in negotiation can be confirmed',
            code: 'SOURCING_NOT_NEGOTIATING',
          });
        }
        const place = await this.deliveryPlace(tx, dto);
        const offers = pricedOffers(await acceptedOffers(tx, id));
        requireVerifiedFarms(offers.map(({ row }) => row.farm));
        assertCovered(
          request,
          offers.map(({ row }) => row),
        );
        const agreed = new Prisma.Decimal(dto.agreedPrice);
        assertAgreedPrice(agreed, quote(offers, this.checkout).suggestedPrice);
        await tx.sourcingRequest.update({
          where: { id },
          data: {
            agreedPrice: agreed,
            deliveryCountry: dto.deliveryCountry,
            deliveryAddress: dto.deliveryAddress,
            deliveryRegion: dto.deliveryRegion ?? null,
            deliveryStateId: dto.deliveryStateId ?? null,
            deliveryLgaId: dto.deliveryLgaId ?? null,
            deliveryContactName: dto.deliveryContactName ?? null,
            deliveryContactPhone: dto.deliveryContactPhone ?? null,
            deliveryFrom: toDateColumn(dto.deliveryFrom),
            deliveryTo: toDateColumn(dto.deliveryTo),
          },
        });
        const created = await tx.sourcingContract.create({
          data: {
            sourcingRequestId: id,
            agreedPrice: agreed,
            terms: contractTerms(
              request,
              agentOf(request),
              dto,
              place,
              offers,
              agreed,
            ),
          },
        });
        await moveSourcingStatus(
          tx,
          id,
          SourcingRequestStatus.CONFIRMED,
          'AGENT',
        );
        await this.record(
          tx,
          request,
          party,
          'Contract issued',
          `${request.requestNumber} at ${agreed.toFixed(2)}`,
        );
        const ids = await this.notifications.notify(
          {
            userIds: [request.buyer.userId],
            type: NotificationType.SOURCING_CONTRACT_READY,
            params: { requestId: id, requestNumber: request.requestNumber },
          },
          tx,
        );
        return { contract: created, deliveryIds: ids };
      },
    );
    void this.notifications.dispatch(deliveryIds);
    return formatSourcingContract(contract, null);
  }

  /**
   * The second signature creates the hidden listings and places the buyer's
   * checkout at the agreed prices. `idempotencyKey` keys that checkout, so a retried
   * second signature returns it rather than placing another.
   */
  async sign(
    id: string,
    party: ContractParty,
    idempotencyKey: string,
  ): Promise<SourcingContractDto> {
    const outcome = await busyAsConflict(() =>
      this.database.$transaction(async (tx): Promise<SignOutcome> => {
        await advisoryLock(tx, `sourcing:${id}`);
        const request = await this.requireParty(tx, id, party);
        const replay = await findReplay(tx, request.buyerId, idempotencyKey);
        if (replay) {
          if (replay.sourcingRequestId !== id) {
            throw new ConflictException(
              'Idempotency-Key already belongs to another checkout',
            );
          }
          const latest = await tx.sourcingContract.findFirst({
            where: { sourcingRequestId: id },
            orderBy: { createdAt: 'desc' },
          });
          if (!latest) {
            throw new NotFoundException('No contract yet');
          }
          // A checkout placed before the newest contract belongs to an older,
          // since-voided one; replaying it would silently skip this signature.
          if (replay.createdAt < latest.createdAt) {
            throw new ConflictException({
              message:
                'Idempotency-Key was already used for an earlier contract',
              code: 'IDEMPOTENCY_KEY_REUSED',
            });
          }
          return {
            contract: formatSourcingContract(latest, replay.id),
            deliveryIds: [],
          };
        }
        if (request.status !== SourcingRequestStatus.CONFIRMED) {
          throw new ConflictException({
            message: 'There is no contract waiting to be signed',
            code: 'SOURCING_NOT_CONFIRMED',
          });
        }
        const live = await tx.sourcingContract.findFirst({
          where: { sourcingRequestId: id, voidedAt: null },
        });
        if (!live) {
          throw new ConflictException({
            message: 'There is no contract waiting to be signed',
            code: 'SOURCING_NOT_CONFIRMED',
          });
        }
        if (signedBy(live, party)) {
          return { contract: await this.present(tx, live), deliveryIds: [] };
        }
        const otherSigned =
          party.role === 'BUYER' ? live.agentSignedAt : live.buyerSignedAt;
        if (!otherSigned) {
          const signed = await this.recordSignature(
            tx,
            request,
            live,
            party,
            new Date(),
          );
          return {
            contract: formatSourcingContract(signed, null),
            deliveryIds: [],
          };
        }
        return this.complete(tx, request, live, party, idempotencyKey);
      }, CHECKOUT_TRANSACTION),
    );
    void this.notifications.dispatch(outcome.deliveryIds);
    return outcome.contract;
  }

  private async complete(
    tx: Prisma.TransactionClient,
    request: ContractRequest,
    live: SourcingContract,
    party: ContractParty,
    idempotencyKey: string,
  ): Promise<SignOutcome> {
    const agent = agentOf(request);
    const offers = pricedOffers(await acceptedOffers(tx, request.id));
    const figures = quote(offers, this.checkout);
    assertAgreedPrice(live.agreedPrice, figures.suggestedPrice);
    const delivery = deliverySnapshot(request);
    const lines: OrderLine[] = [];
    for (const offer of offers) {
      const listing = await createSourcedListing(
        tx,
        request.produceName,
        offer,
      );
      lines.push(orderLine(listing, offer.quantity));
    }
    const now = new Date();
    const checkout = await createCheckout(
      tx,
      {
        buyerId: request.buyerId,
        idempotencyKey,
        lines,
        delivery,
        expectedTotal: live.agreedPrice.toNumber(),
        sourcingRequestId: request.id,
        sourced: {
          figures: sourcedFigures(live.agreedPrice, figures),
          holdMs: this.config.checkoutHoldHours * 3_600_000,
          commissionAgentId: agent.id,
        },
        // Not the signer: an agent actor would need agentId on each order's
        // audit row (AuditEvent_actor_check). The signature row names them.
        placedBy: auditActor(null),
      },
      this.checkout,
      now,
    );
    const signed = await this.recordSignature(
      tx,
      request,
      live,
      party,
      now,
      checkout.checkoutNumber,
    );
    const deliveryIds = await this.notifications.notify(
      {
        userIds: [request.buyer.userId],
        type: NotificationType.SOURCING_PAYMENT_READY,
        params: {
          requestId: request.id,
          requestNumber: request.requestNumber,
          checkoutId: checkout.id,
          amount: checkout.totalPrice.toFixed(2),
        },
      },
      tx,
    );
    return {
      contract: formatSourcingContract(signed, checkout.id),
      deliveryIds,
    };
  }

  private async recordSignature(
    tx: Prisma.TransactionClient,
    request: ContractRequest,
    live: SourcingContract,
    party: ContractParty,
    at: Date,
    checkoutNumber?: string,
  ): Promise<SourcingContract> {
    const signed = await tx.sourcingContract.update({
      where: { id: live.id },
      data:
        party.role === 'BUYER' ? { buyerSignedAt: at } : { agentSignedAt: at },
    });
    const who = party.role === 'BUYER' ? 'Buyer' : 'Agent';
    await this.record(
      tx,
      request,
      party,
      'Contract signed',
      checkoutNumber
        ? `${who} signed; checkout ${checkoutNumber} placed`
        : `${who} signed`,
    );
    return signed;
  }

  private async present(
    client: Prisma.TransactionClient,
    contract: SourcingContract,
  ): Promise<SourcingContractDto> {
    if (!isFullySigned(contract)) {
      return formatSourcingContract(contract, null);
    }
    // The checkout the second signature placed; there is no direct link.
    const checkout = await client.checkout.findFirst({
      where: {
        sourcingRequestId: contract.sourcingRequestId,
        createdAt: { gte: contract.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return formatSourcingContract(contract, checkout?.id ?? null);
  }

  private async deliveryPlace(
    tx: Prisma.TransactionClient,
    dto: ConfirmSourcingDto,
  ): Promise<{ state: string | null; lga: string | null }> {
    // The DTO requires both for Nigeria and refuses them elsewhere.
    if (!dto.deliveryStateId || !dto.deliveryLgaId) {
      return { state: null, lga: null };
    }
    const lga = await this.locations.requireLga(
      dto.deliveryStateId,
      dto.deliveryLgaId,
      tx,
    );
    const state = await tx.state.findUniqueOrThrow({
      where: { id: dto.deliveryStateId },
    });
    return { state: state.name, lga: lga.name };
  }

  private async record(
    tx: Prisma.TransactionClient,
    request: ContractRequest,
    party: ContractParty | null,
    title: string,
    summary: string,
  ): Promise<void> {
    const actor = auditActor(party);
    await this.audit.record(tx, {
      actorType: actor.type,
      actorUserId: actor.userId,
      farmerId: null,
      // AuditEvent_actor_check: only an agent actor may carry agentId.
      agentId:
        actor.type === AuditActorType.EXTENSION_AGENT
          ? request.assignedAgentId
          : null,
      farmId: null,
      category: AuditCategory.SOURCING,
      title,
      summary,
      actionLabel: 'View request',
      resource: AuditResource.SOURCING_REQUEST,
      resourceId: request.id,
      sourcingRequestId: request.id,
    });
  }

  // Another party's request is 404, the same as a missing one.
  private async requireParty(
    client: Prisma.TransactionClient,
    id: string,
    party: ContractParty,
  ): Promise<ContractRequest> {
    const request = await client.sourcingRequest.findUnique({
      where: { id },
      include: CONTRACT_REQUEST_INCLUDE,
    });
    const owner =
      party.role === 'BUYER'
        ? request?.buyer.userId
        : request?.assignedAgent?.userId;
    if (!request || owner !== party.userId) {
      throw new NotFoundException('Sourcing request not found');
    }
    return request;
  }
}
