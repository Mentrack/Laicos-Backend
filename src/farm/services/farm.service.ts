import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FarmVerificationStatus,
  VerificationTaskStatus,
  type Prisma,
  type User,
} from '../../../generated/client';
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
import { farmOwnedBy } from '../../common/ownership';
import {
  DOCUMENT_SIGNATURES,
  type StorageUploadFile,
} from '../../common/upload-pipes';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AssignmentService } from '../../verification/services/assignment.service';
import { CreateFarmDto, UpdateFarmDto } from '../dto';
import { FARM_INCLUDE, formatFarm } from '../formatters/farm.formatter';

export interface FarmDocuments {
  ownershipDocument: StorageUploadFile;
  chiefConfirmation?: StorageUploadFile;
}

const OPEN_ROUND_STATUSES: VerificationTaskStatus[] = [
  VerificationTaskStatus.UNASSIGNED,
  VerificationTaskStatus.ASSIGNED,
  VerificationTaskStatus.IN_PROGRESS,
];

/** Every method is scoped to farms owned by `user`'s Farmer. */
@Injectable()
export class FarmService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly locations: LocationService,
    private readonly assignment: AssignmentService,
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
    const uploaded: string[] = [];
    let farm: Prisma.FarmGetPayload<{ include: typeof FARM_INCLUDE }>;
    try {
      const ownershipDocumentKey = await this.storage.uploadPrivateFile(
        `farms/${id}/ownership`,
        documents.ownershipDocument,
        DOCUMENT_SIGNATURES,
      );
      uploaded.push(ownershipDocumentKey);
      const chiefConfirmationKey = documents.chiefConfirmation
        ? await this.storage.uploadPrivateFile(
            `farms/${id}/chief-confirmation`,
            documents.chiefConfirmation,
            DOCUMENT_SIGNATURES,
          )
        : null;
      if (chiefConfirmationKey) {
        uploaded.push(chiefConfirmationKey);
      }
      farm = await this.database.$transaction(async (tx) => {
        await tx.farm.create({
          data: {
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
          },
        });
        await this.assignment.openRound(tx, id);
        return tx.farm.findUniqueOrThrow({
          where: { id },
          include: FARM_INCLUDE,
        });
      });
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      throw mapFarmSaveError(error);
    }
    return formatFarm(this.storage, farm);
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
      where: { id, ...farmOwnedBy(user) },
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
function mapFarmSaveError(error: unknown): unknown {
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

function mapFarmDeleteError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundException('Farm not found');
  }
  if (isForeignKeyViolation(error)) {
    return new ConflictException('Farm has orders and cannot be deleted');
  }
  return error;
}
