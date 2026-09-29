import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EvidenceKind,
  FarmVerificationStatus,
  Prisma,
  VerificationTaskStatus,
  type Agent,
  type VerificationCheckKey,
} from '../../../generated/client';
import { paginationMeta, resolvePagination } from '../../common/pagination';
import {
  IMAGE_SIGNATURES,
  type StorageUploadFile,
} from '../../common/upload-pipes';
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
  checklistGaps,
  evidenceShapeError,
  isResultAllowed,
} from '../utils/checklist';
import { AssignmentService, OPEN_TASK_STATUSES } from './assignment.service';

type Tx = Prisma.TransactionClient;

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
    await this.database.$transaction((tx) => this.record(tx, agent, id, data));
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
      await this.record(tx, agent, id, {});
      await tx.verificationCheck.upsert({
        where: { verificationId_key: { verificationId: id, key } },
        create: { verificationId: id, key, ...values },
        update: values,
      });
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
    const shapeError = evidenceShapeError(dto);
    if (shapeError) {
      throw new BadRequestException(shapeError);
    }
    // Checked before uploading, so a closed or foreign round doesn't leave an
    // object behind; record() below re-checks inside the transaction.
    await this.requireOpen(this.database, agent, id);
    const storageKey = await this.storage.uploadPrivateFile(
      `verifications/${id}`,
      file,
      IMAGE_SIGNATURES,
    );

    let replaced: string[];
    try {
      replaced = await this.database.$transaction(async (tx) => {
        await this.record(tx, agent, id, {});
        // One photo per slot: a new one replaces the old.
        const previous =
          dto.kind === EvidenceKind.PHOTO
            ? await tx.verificationEvidence.findMany({
                where: { verificationId: id, photoSlot: dto.photoSlot },
                select: { id: true, storageKey: true },
              })
            : [];
        await tx.verificationEvidence.deleteMany({
          where: { id: { in: previous.map((item) => item.id) } },
        });
        await tx.verificationEvidence.create({
          data: {
            verificationId: id,
            kind: dto.kind,
            checkKey: dto.checkKey ?? null,
            photoSlot: dto.photoSlot ?? null,
            storageKey,
          },
        });
        return previous.map((item) => item.storageKey);
      });
    } catch (error) {
      await this.storage.deletePrivate([storageKey]);
      throw error;
    }
    await this.storage.deletePrivate(replaced);
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
      await this.transition(tx, agent, id, {
        status: VerificationTaskStatus.UNASSIGNED,
        agentId: null,
      });
      await tx.assignmentDecline.create({
        data: { verificationId: id, agentId: agent.id, reason: dto.reason },
      });
      const deleted = await this.assignment.resetRound(tx, id);
      await this.assignment.assign(tx, id);
      return deleted;
    });
    await this.storage.deletePrivate(keys);
  }

  /** Verifies the farm and puts it in this agent's cluster. */
  async approve(agent: Agent, id: string) {
    await this.database.$transaction(async (tx) => {
      const round = await tx.farmVerification.findFirst({
        where: { id, agentId: agent.id },
        include: { checks: true, evidence: true },
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
      const cluster = await tx.cluster.findUniqueOrThrow({
        where: { agentId: agent.id },
        select: { id: true },
      });
      await tx.farm.update({
        where: { id: farmId },
        data: {
          verificationStatus: FarmVerificationStatus.VERIFIED,
          clusterId: cluster.id,
          isClustered: true,
        },
      });
    });
    return this.findOne(agent, id);
  }

  /** Needs no completed checklist: agents reject early, e.g. no farm exists. */
  async reject(agent: Agent, id: string, dto: VerificationReasonDto) {
    await this.database.$transaction(async (tx) => {
      const { farmId } = await this.transition(tx, agent, id, {
        status: VerificationTaskStatus.REJECTED,
        rejectionReason: dto.reason,
        decidedAt: new Date(),
      });
      await tx.farm.update({
        where: { id: farmId },
        data: {
          verificationStatus: FarmVerificationStatus.REJECTED,
          clusterId: null,
          isClustered: false,
        },
      });
    });
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
  }
}
