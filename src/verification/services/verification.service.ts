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
  EvidenceKind,
  FarmerStatus,
  FarmVerificationStatus,
  Prisma,
  VerificationTaskStatus,
  type Agent,
  type VerificationCheckKey,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { verificationDocumentsSummary } from '../../farm/utils/farm-document-summary';
import { paginationMeta, resolvePagination } from '../../common/pagination';
import {
  IMAGE_SIGNATURES,
  type StorageUploadFile,
} from '../../common/upload-pipes';
import { FarmerActivationService } from '../../auth/farmer-activation.service';
import { OPEN_HANDOVER_STATUSES } from '../../handover/formatters/handover.formatter';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  AddEvidenceDto,
  SaveCheckDto,
  SaveLocationDto,
  UpdateVerificationDto,
  VerificationQueryDto,
  VerificationReasonDto,
} from '../dto';
import {
  VERIFICATION_DETAIL_INCLUDE,
  VERIFICATION_SUMMARY_INCLUDE,
  formatVerification,
  formatVerificationSummary,
} from '../formatters/verification.formatter';
import {
  CHECKLIST_DOCUMENTS_SELECT,
  checklistGaps,
  isResultAllowed,
} from '../utils/checklist';
import { refreshFarmEvidenceStatus } from '../utils/evidence-status';
import {
  documentUpdate,
  evidenceRequestError,
  storedDocumentKey,
} from '../utils/expected-document';
import { AssignmentService, OPEN_TASK_STATUSES } from './assignment.service';
import {
  FarmDocumentsService,
  type FarmDocumentUploads,
} from './farm-documents.service';

type Tx = Prisma.TransactionClient;

// What the farmer's notification needs once the decision commits.
const FARM_OWNER_SELECT = {
  name: true,
  owner: { select: { id: true, userId: true } },
} satisfies Prisma.FarmSelect;

/**
 * An agent's work on the rounds assigned to them. Every method is scoped to
 * the calling agent: another agent's round reads as not found, so round ids
 * can't be probed.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly assignment: AssignmentService,
    private readonly activation: FarmerActivationService,
    private readonly documents: FarmDocumentsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(agent: Agent, query: VerificationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.FarmVerificationWhereInput = {
      agentId: agent.id,
      status: query.status,
    };
    const [rows, total] = await this.database.$transaction([
      this.database.farmVerification.findMany({
        where,
        include: VERIFICATION_SUMMARY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farmVerification.count({ where }),
    ]);
    return {
      data: rows.map(formatVerificationSummary),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(agent: Agent, id: string) {
    const round = await this.database.farmVerification.findFirst({
      where: { id, agentId: agent.id },
      include: VERIFICATION_DETAIL_INCLUDE,
    });
    if (!round) {
      throw new NotFoundException('Verification not found');
    }
    return formatVerification(this.storage, round);
  }

  async saveLocation(agent: Agent, id: string, dto: SaveLocationDto) {
    const data = dto.matches
      ? {
          locationMatches: true,
          discrepancyLat: null,
          discrepancyLng: null,
          discrepancyNote: null,
        }
      : {
          locationMatches: false,
          discrepancyLat: dto.latitude ?? null,
          discrepancyLng: dto.longitude ?? null,
          discrepancyNote: dto.note ?? null,
        };
    await this.database.$transaction(async (tx) => {
      const round = await this.record(tx, agent, id, data);
      const farm = await tx.farm.findUniqueOrThrow({
        where: { id: round.farmId },
        select: { farmCode: true },
      });
      await this.auditVerificationRound(
        tx,
        agent,
        round.farmId,
        'Verification location saved',
        farm.farmCode,
      );
    });
    return this.findOne(agent, id);
  }

  async saveCheck(
    agent: Agent,
    id: string,
    key: VerificationCheckKey,
    dto: SaveCheckDto,
  ) {
    if (!isResultAllowed(key, dto.result)) {
      throw new BadRequestException(`${key} does not accept ${dto.result}`);
    }
    const values = { result: dto.result, note: dto.note ?? null };
    await this.database.$transaction(async (tx) => {
      const round = await this.record(tx, agent, id, {});
      await tx.verificationCheck.upsert({
        where: { verificationId_key: { verificationId: id, key } },
        create: { verificationId: id, key, ...values },
        update: values,
      });
      const farm = await tx.farm.findUniqueOrThrow({
        where: { id: round.farmId },
        select: { farmCode: true },
      });
      await this.auditVerificationRound(
        tx,
        agent,
        round.farmId,
        'Verification check saved',
        `${key} on ${farm.farmCode}`,
      );
    });
    return this.findOne(agent, id);
  }

  async update(agent: Agent, id: string, dto: UpdateVerificationDto) {
    await this.database.$transaction((tx) =>
      this.record(tx, agent, id, {
        identityNote: dto.identityNote,
        measuredSize: dto.measuredSize,
        estimatedYield: dto.estimatedYield,
        estimatedYieldUnit: dto.estimatedYieldUnit,
        generalNote: dto.generalNote,
        evidenceStatus: dto.evidenceStatus,
      }),
    );
    return this.findOne(agent, id);
  }

  async addEvidence(
    agent: Agent,
    id: string,
    dto: AddEvidenceDto,
    file: StorageUploadFile,
  ) {
    const shapeError = evidenceRequestError(dto);
    if (shapeError) {
      throw new BadRequestException(shapeError);
    }
    // Checked before uploading, so a closed or foreign round doesn't leave an
    // object behind; record() below re-checks inside the transaction.
    const { farmId } = await this.requireOpen(this.database, agent, id);
    const storageKey = await this.storage.uploadPrivateFile(
      `verifications/${id}`,
      file,
      IMAGE_SIGNATURES,
    );

    let replaced: string[];
    try {
      replaced = await this.database.$transaction(async (tx) => {
        const round = await this.record(tx, agent, id, {});
        const farm = await tx.farm.findUniqueOrThrow({
          where: { id: round.farmId },
          select: { farmCode: true },
        });
        await this.auditVerificationRound(
          tx,
          agent,
          round.farmId,
          'Verification evidence saved',
          farm.farmCode,
        );
        if (dto.document) {
          const current = await tx.farmVerification.findUnique({
            where: { id },
            select: {
              locationEvidenceKey: true,
              productionEvidenceKey: true,
              farmPlotSketchKey: true,
              harvestEstimateKey: true,
            },
          });
          if (!current) {
            throw new NotFoundException('Verification not found');
          }
          const previous = storedDocumentKey(current, dto.document);
          await tx.farmVerification.update({
            where: { id },
            data: documentUpdate(dto.document, storageKey),
          });
          await refreshFarmEvidenceStatus(tx, farmId);
          return previous ? [previous] : [];
        }
        if (!dto.checkKey) {
          throw new BadRequestException('Send either a document or a checkKey');
        }
        await tx.verificationEvidence.create({
          data: {
            verificationId: id,
            kind: EvidenceKind.CHECK,
            checkKey: dto.checkKey,
            storageKey,
          },
        });
        return [];
      });
    } catch (error) {
      await this.storage.deletePrivate([storageKey]);
      throw error;
    }
    await this.storage.deletePrivate(replaced);
    return this.findOne(agent, id);
  }

  /**
   * The farmer's ID or the farm's documents, collected on site when the
   * farmer couldn't supply them (they have no login before verification).
   */
  async uploadDocuments(
    agent: Agent,
    id: string,
    uploads: FarmDocumentUploads,
  ) {
    const { farmId } = await this.requireOpen(this.database, agent, id);
    const farm = await this.database.farm.findUniqueOrThrow({
      where: { id: farmId },
      select: { farmCode: true },
    });
    await this.documents.replace(
      farmId,
      {
        verifications: {
          some: {
            id,
            agentId: agent.id,
            status: { in: OPEN_TASK_STATUSES },
          },
        },
      },
      uploads,
      [
        {
          actorType: AuditActorType.EXTENSION_AGENT,
          farmerId: null,
          agentId: agent.id,
          farmId,
          category: AuditCategory.VERIFICATION,
          title: 'Verification documents saved',
          summary: verificationDocumentsSummary(farm.farmCode, uploads),
          actionLabel: 'View farm',
          resource: AuditResource.FARM,
          resourceId: farmId,
        },
      ],
    );
    return this.findOne(agent, id);
  }

  async removeEvidence(agent: Agent, id: string, evidenceId: string) {
    const storageKey = await this.database.$transaction(async (tx) => {
      await this.record(tx, agent, id, {});
      const evidence = await tx.verificationEvidence.findFirst({
        where: { id: evidenceId, verificationId: id },
        select: { storageKey: true },
      });
      if (!evidence) {
        throw new NotFoundException('Evidence not found');
      }
      await tx.verificationEvidence.delete({ where: { id: evidenceId } });
      return evidence.storageKey;
    });
    await this.storage.deletePrivate([storageKey]);
    return this.findOne(agent, id);
  }

  /** Hands the round to the next eligible agent; this one is never re-picked. */
  async decline(agent: Agent, id: string, dto: VerificationReasonDto) {
    const keys = await this.database.$transaction(async (tx) => {
      const { farmId } = await this.transition(tx, agent, id, {
        status: VerificationTaskStatus.UNASSIGNED,
        agentId: null,
      });
      await tx.assignmentDecline.create({
        data: { verificationId: id, agentId: agent.id, reason: dto.reason },
      });
      await this.auditVerificationRound(
        tx,
        agent,
        farmId,
        'Verification declined',
        dto.reason,
      );
      const deleted = await this.assignment.resetRound(tx, id);
      await this.assignment.assign(tx, id);
      return deleted;
    });
    await this.storage.deletePrivate(keys);
  }

  /**
   * Verifies the farm and puts it in this agent's cluster. A farmer's first
   * verified farm activates them (and sends the invite) once this commits.
   */
  async approve(agent: Agent, id: string) {
    const farmerUserId = await this.database.$transaction(async (tx) => {
      const round = await tx.farmVerification.findFirst({
        where: { id, agentId: agent.id },
        include: {
          checks: true,
          evidence: true,
          farm: { select: CHECKLIST_DOCUMENTS_SELECT },
        },
      });
      if (!round) {
        throw new NotFoundException('Verification not found');
      }
      const gaps = checklistGaps(round);
      if (gaps.length) {
        // An array message: the filter puts every gap in error.details.
        throw new BadRequestException(gaps);
      }
      const { farmId } = await this.transition(tx, agent, id, {
        status: VerificationTaskStatus.APPROVED,
        decidedAt: new Date(),
      });
      const verifiedFarm = await tx.farm.findUniqueOrThrow({
        where: { id: farmId },
        select: { farmCode: true, name: true },
      });
      await this.auditVerificationRound(
        tx,
        agent,
        farmId,
        `Farm ${verifiedFarm.farmCode} verified`,
        verifiedFarm.name,
      );
      const cluster = await tx.cluster.findUniqueOrThrow({
        where: { agentId: agent.id },
        select: { id: true },
      });
      const { owner } = await tx.farm.update({
        where: { id: farmId },
        data: {
          verificationStatus: FarmVerificationStatus.VERIFIED,
          clusterId: cluster.id,
          isClustered: true,
        },
        select: FARM_OWNER_SELECT,
      });
      // A suspended account comes back only when a farm is verified again.
      await tx.farmer.update({
        where: { id: owner.id },
        data: { status: FarmerStatus.ACTIVE },
      });
      // Orders that went READY while the farm was out of every cluster.
      await tx.orderHandover.updateMany({
        where: {
          agentId: null,
          status: { in: OPEN_HANDOVER_STATUSES },
          order: { farmId },
        },
        data: { agentId: agent.id },
      });
      return owner.userId;
    });
    await this.activation.activate(farmerUserId);
    return this.findOne(agent, id);
  }

  /** Needs no completed checklist: agents reject early, e.g. no farm exists. */
  async reject(agent: Agent, id: string, dto: VerificationReasonDto) {
    const rejected = await this.database.$transaction(async (tx) => {
      const { farmId } = await this.transition(tx, agent, id, {
        status: VerificationTaskStatus.REJECTED,
        rejectionReason: dto.reason,
        decidedAt: new Date(),
      });
      const rejectedFarm = await tx.farm.findUniqueOrThrow({
        where: { id: farmId },
        select: { farmCode: true },
      });
      await this.auditVerificationRound(
        tx,
        agent,
        farmId,
        `Farm ${rejectedFarm.farmCode} rejected`,
        dto.reason,
      );
      return tx.farm.update({
        where: { id: farmId },
        data: {
          verificationStatus: FarmVerificationStatus.REJECTED,
          clusterId: null,
          isClustered: false,
        },
        select: FARM_OWNER_SELECT,
      });
    });
    await this.activation.notifyRejection(
      rejected.owner.userId,
      rejected.name,
      dto.reason,
    );
    return this.findOne(agent, id);
  }

  /** 404 unless the round is the agent's; 409 unless it is still open. */
  private async requireOpen(client: Tx, agent: Agent, id: string) {
    const round = await client.farmVerification.findFirst({
      where: { id, agentId: agent.id },
      select: { farmId: true, status: true, startedAt: true },
    });
    if (!round) {
      throw new NotFoundException('Verification not found');
    }
    if (!OPEN_TASK_STATUSES.includes(round.status)) {
      throw new ConflictException('Verification is no longer open');
    }
    return round;
  }

  /**
   * Applies `data` only while the round is still open and the agent's.
   * Guarded by the updateMany itself, so a round decided or reassigned
   * between the read and this write is a 409, not a silent overwrite.
   */
  private async transition(
    tx: Tx,
    agent: Agent,
    id: string,
    data: Prisma.FarmVerificationUncheckedUpdateManyInput,
  ) {
    const round = await this.requireOpen(tx, agent, id);
    const { count } = await tx.farmVerification.updateMany({
      where: { id, agentId: agent.id, status: { in: OPEN_TASK_STATUSES } },
      data,
    });
    if (!count) {
      throw new ConflictException('Verification is no longer open');
    }
    return round;
  }

  /** A draft save: the first one starts the task. */
  private async record(
    tx: Tx,
    agent: Agent,
    id: string,
    data: Prisma.FarmVerificationUncheckedUpdateManyInput,
  ) {
    const round = await this.transition(tx, agent, id, {
      ...data,
      status: VerificationTaskStatus.IN_PROGRESS,
    });
    if (!round.startedAt) {
      await tx.farmVerification.update({
        where: { id },
        data: { startedAt: new Date() },
      });
    }
    return round;
  }

  private async auditVerificationRound(
    tx: Tx,
    agent: Agent,
    farmId: string,
    title: string,
    summary: string,
  ) {
    await this.audit.record(tx, {
      actorType: AuditActorType.EXTENSION_AGENT,
      farmerId: null,
      agentId: agent.id,
      farmId,
      category: AuditCategory.VERIFICATION,
      title,
      summary,
      actionLabel: 'View farm',
      resource: AuditResource.FARM,
      resourceId: farmId,
    });
  }
}
