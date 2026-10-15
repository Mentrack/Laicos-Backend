import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  VerificationTaskStatus,
  type Prisma,
  type User,
} from '../../../generated/client';
import { AuditService, type AuditWrite } from '../../audit/audit.service';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../../common/pagination';
import {
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueViolation,
} from '../../common/prisma-errors';
import { farmOwnedBy, farmReadableBy } from '../../common/ownership';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AssignmentService } from '../../verification/services/assignment.service';
import {
  FarmDocumentsService,
  type FarmDocumentUploads,
} from '../../verification/services/farm-documents.service';
import { CreateFarmDto, UpdateFarmDto } from '../dto';
import { farmDocumentsSummary } from '../utils/farm-document-summary';
import {
  FARM_INCLUDE,
  formatFarm,
  type FarmRow,
} from '../formatters/farm.formatter';

// The farmer's own ID goes through POST /farmers/me/id-document.
export type FarmDocuments = Omit<FarmDocumentUploads, 'idDocument'>;

const OPEN_ROUND_STATUSES: VerificationTaskStatus[] = [
  VerificationTaskStatus.UNASSIGNED,
  VerificationTaskStatus.ASSIGNED,
  VerificationTaskStatus.IN_PROGRESS,
];

/** Writes stay owner-scoped. Reads also allow a cluster agent. */
@Injectable()
export class FarmService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly locations: LocationService,
    private readonly assignment: AssignmentService,
    private readonly documents: FarmDocumentsService,
    private readonly audit: AuditService,
  ) {}

  /** Creates the farm and opens its first verification round. */
  async create(user: User, dto: CreateFarmDto, documents: FarmDocuments) {
    const farmer = await this.database.farmer.findUnique({
      where: { userId: user.id },
      select: { id: true, idDocumentKey: true },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer profile not found');
    }
    // The agent's identity check compares the farmer against this document.
    if (!farmer.idDocumentKey) {
      throw new BadRequestException(
        'Upload your ID document before creating a farm',
      );
    }
    await this.locations.requireLga(dto.stateId, dto.lgaId);

    // Drawn here so the documents are stored under the farm's final key.
    // Uploads come first to have keys to persist; any failure after them
    // deletes what was uploaded.
    const id = randomUUID();
    const { ownershipDocumentKey, chiefConfirmationKey, uploaded } =
      await this.documents.uploadAll(farmer.id, id, documents);
    let farm: FarmRow;
    try {
      const created = await this.database.$transaction(async (tx) => {
        const result = await this.insertFarm(tx, {
          id,
          ownerId: farmer.id,
          name: dto.name,
          stateId: dto.stateId,
          lgaId: dto.lgaId,
          location: dto.location,
          size: dto.size,
          unit: dto.unit,
          mainProduce: dto.mainProduce,
          isExporting: dto.isExporting,
          referralAgentId: dto.referralAgentId,
          ownershipDocumentKey,
          chiefConfirmationKey,
        });
        const { farm: inserted } = result;
        await this.audit.record(tx, {
          actorType: AuditActorType.FARMER,
          farmerId: farmer.id,
          agentId: null,
          farmId: inserted.id,
          category: AuditCategory.FARM,
          title: `Farm ${inserted.farmCode} created`,
          summary: `${inserted.name}, ${inserted.mainProduce}`,
          actionLabel: 'View farm',
          resource: AuditResource.FARM,
          resourceId: inserted.id,
        });
        const docSummary = farmDocumentsSummary(
          ownershipDocumentKey,
          chiefConfirmationKey,
        );
        if (docSummary) {
          await this.audit.record(tx, {
            actorType: AuditActorType.FARMER,
            farmerId: farmer.id,
            agentId: null,
            farmId: inserted.id,
            category: AuditCategory.DOCUMENTS,
            title: 'Farm documents uploaded',
            summary: docSummary,
            actionLabel: 'View farm',
            resource: AuditResource.FARM,
            resourceId: inserted.id,
          });
        }
        return result;
      });
      farm = created.farm;
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      throw mapFarmSaveError(error);
    }
    return formatFarm(this.storage, farm);
  }

  /**
   * Inserts a farm and opens its first verification round, inside `tx`.
   * Shared by farmer self-service and agent onboarding, which prefers itself
   * as the round's agent.
   */
  async insertFarm(
    tx: Prisma.TransactionClient,
    data: Prisma.FarmUncheckedCreateInput,
    preferredAgentId?: string,
  ): Promise<{ farm: FarmRow; verificationId: string }> {
    const id = data.id ?? randomUUID();
    await tx.farm.create({ data: { ...data, id } });
    const verificationId = await this.assignment.openRound(
      tx,
      id,
      preferredAgentId,
    );
    const farm = await tx.farm.findUniqueOrThrow({
      where: { id },
      include: FARM_INCLUDE,
    });
    return { farm, verificationId };
  }

  async findAll(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = farmOwnedBy(user);
    const [farms, total] = await this.database.$transaction([
      this.database.farm.findMany({
        where,
        include: FARM_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farm.count({ where }),
    ]);
    return {
      data: await Promise.all(
        farms.map((farm) => formatFarm(this.storage, farm)),
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(user: User, id: string) {
    const farm = await this.database.farm.findFirst({
      where: { id, ...farmReadableBy(user) },
      include: FARM_INCLUDE,
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    return formatFarm(this.storage, farm);
  }

  /**
   * Editing a REJECTED farm resubmits it. Moving a VERIFIED farm (state, LGA
   * or address) sends it back through verification, out of its cluster.
   * Moving a PENDING farm to another LGA hands its open round to that LGA.
   */
  async update(user: User, id: string, dto: UpdateFarmDto) {
    const current = await this.database.farm.findFirst({
      where: { id, ...farmOwnedBy(user) },
      select: {
        stateId: true,
        lgaId: true,
        location: true,
        verificationStatus: true,
        farmCode: true,
        name: true,
        ownerId: true,
      },
    });
    if (!current) {
      throw new NotFoundException('Farm not found');
    }
    const stateId = dto.stateId ?? current.stateId;
    const lgaId = dto.lgaId ?? current.lgaId;
    if (dto.stateId !== undefined || dto.lgaId !== undefined) {
      await this.locations.requireLga(stateId, lgaId);
    }
    const lgaChanged = lgaId !== current.lgaId;
    const moved =
      lgaChanged ||
      stateId !== current.stateId ||
      (dto.location !== undefined && dto.location !== current.location);
    const reopen =
      current.verificationStatus === FarmVerificationStatus.REJECTED ||
      (current.verificationStatus === FarmVerificationStatus.VERIFIED && moved);

    let staleKeys: string[] = [];
    try {
      staleKeys = await this.database.$transaction(async (tx) => {
        await tx.farm.update({
          where: { id, ...farmOwnedBy(user) },
          data: {
            name: dto.name,
            stateId,
            lgaId,
            location: dto.location,
            size: dto.size,
            unit: dto.unit,
            mainProduce: dto.mainProduce,
            isExporting: dto.isExporting,
            referralAgentId: dto.referralAgentId,
            ...(reopen && {
              verificationStatus: FarmVerificationStatus.PENDING,
              clusterId: null,
              isClustered: false,
            }),
          },
        });
        const name = dto.name ?? current.name;
        await this.audit.record(tx, {
          actorType: AuditActorType.FARMER,
          farmerId: current.ownerId,
          agentId: null,
          farmId: id,
          category: AuditCategory.FARM,
          title: `Farm ${current.farmCode} updated`,
          summary: name,
          actionLabel: 'View farm',
          resource: AuditResource.FARM,
          resourceId: id,
        });
        if (reopen) {
          // A resubmission goes back to the agent who decided the last round,
          // if they still cover the farm's LGA.
          const previous = await tx.farmVerification.findFirst({
            where: { farmId: id },
            orderBy: { createdAt: 'desc' },
            select: { agentId: true },
          });
          await this.assignment.openRound(
            tx,
            id,
            lgaChanged ? null : previous?.agentId,
          );
          return [];
        }
        if (lgaChanged) {
          return this.reassignOpenRound(tx, id);
        }
        return [];
      });
    } catch (error) {
      throw mapFarmSaveError(error);
    }
    await this.storage.deletePrivate(staleKeys);
    return this.findOne(user, id);
  }

  async replaceDocuments(
    user: User,
    id: string,
    documents: FarmDocumentUploads,
  ) {
    const farmer = await this.database.farmer.findUnique({
      where: { userId: user.id },
      select: { id: true, idType: true },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer profile not found');
    }
    await this.documents.replace(
      id,
      farmOwnedBy(user),
      documents,
      farmerDocumentEvents(farmer, id, documents),
    );
    return this.findOne(user, id);
  }

  async remove(user: User, id: string) {
    const farm = await this.findOne(user, id);
    const stored = await this.database.farm.findUniqueOrThrow({
      where: { id },
      select: {
        ownershipDocumentKey: true,
        chiefConfirmationKey: true,
        verifications: {
          select: { evidence: { select: { storageKey: true } } },
        },
      },
    });
    try {
      await this.database.farm.delete({
        where: { id, ...farmOwnedBy(user) },
      });
    } catch (error) {
      throw mapFarmDeleteError(error);
    }
    // Rounds and evidence rows cascade with the farm; their objects don't.
    await this.storage.deletePrivate([
      stored.ownershipDocumentKey,
      stored.chiefConfirmationKey,
      ...stored.verifications.flatMap((round) =>
        round.evidence.map((item) => item.storageKey),
      ),
    ]);
    return farm;
  }

  /**
   * The open round's agent covers the old LGA, so it starts over in the new
   * one. Declines from the old LGA no longer mean anything and are dropped.
   */
  private async reassignOpenRound(
    tx: Prisma.TransactionClient,
    farmId: string,
  ): Promise<string[]> {
    const open = await tx.farmVerification.findFirst({
      where: { farmId, status: { in: OPEN_ROUND_STATUSES } },
      select: { id: true },
    });
    if (!open) {
      return [];
    }
    await tx.assignmentDecline.deleteMany({
      where: { verificationId: open.id },
    });
    const keys = await this.assignment.resetRound(tx, open.id);
    await this.assignment.assign(tx, open.id);
    return keys;
  }
}

// Another farmer's farm reads as not found, so ids can't be probed for
// existence. On create and update the only foreign key the caller controls
// unchecked is the referral agent.
export function mapFarmSaveError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundException('Farm not found');
  }
  if (isForeignKeyViolation(error)) {
    return new BadRequestException('Referral agent not found');
  }
  // The partial unique index on open rounds: a concurrent edit already
  // reopened this farm.
  if (isUniqueViolation(error)) {
    return new ConflictException('Farm is already awaiting verification');
  }
  return error;
}

function farmerDocumentEvents(
  farmer: { id: string; idType: string | null | undefined },
  farmId: string,
  documents: FarmDocumentUploads,
): AuditWrite[] {
  const events: AuditWrite[] = [];
  if (documents.idDocument) {
    events.push({
      actorType: AuditActorType.FARMER,
      farmerId: farmer.id,
      agentId: null,
      farmId: null,
      category: AuditCategory.DOCUMENTS,
      title: 'ID document uploaded',
      summary: farmer.idType ?? 'ID document',
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: farmer.id,
    });
  }
  if (documents.ownershipDocument) {
    events.push(farmDocumentEvent(farmer.id, farmId, 'ownership'));
  }
  if (documents.chiefConfirmation) {
    events.push(farmDocumentEvent(farmer.id, farmId, 'chief confirmation'));
  }
  return events;
}

function farmDocumentEvent(
  farmerId: string,
  farmId: string,
  summary: string,
): AuditWrite {
  return {
    actorType: AuditActorType.FARMER,
    farmerId,
    agentId: null,
    farmId,
    category: AuditCategory.DOCUMENTS,
    title: 'Farm documents uploaded',
    summary,
    actionLabel: 'View farm',
    resource: AuditResource.FARM,
    resourceId: farmId,
  };
}

function mapFarmDeleteError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundException('Farm not found');
  }
  if (isForeignKeyViolation(error)) {
    return new ConflictException('Farm has orders and cannot be deleted');
  }
  return error;
}
