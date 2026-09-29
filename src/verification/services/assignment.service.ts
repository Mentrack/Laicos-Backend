import { Injectable } from '@nestjs/common';
import { Prisma, VerificationTaskStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { pickAgent } from '../utils/pick-agent';

export const OPEN_TASK_STATUSES: VerificationTaskStatus[] = [
  VerificationTaskStatus.ASSIGNED,
  VerificationTaskStatus.IN_PROGRESS,
];

// Everything an agent can have recorded on a round, cleared when the round
// changes hands.
const CLEARED_ROUND = {
  agentId: null,
  status: VerificationTaskStatus.UNASSIGNED,
  locationMatches: null,
  discrepancyLat: null,
  discrepancyLng: null,
  discrepancyNote: null,
  identityNote: null,
  measuredSize: null,
  estimatedYield: null,
  estimatedYieldUnit: null,
  generalNote: null,
  startedAt: null,
} satisfies Prisma.FarmVerificationUncheckedUpdateInput;

/**
 * The only place a verification round gets an agent. Farm creation,
 * resubmission, location changes, declines and the retry job all come
 * through here, inside the caller's transaction.
 */
@Injectable()
export class AssignmentService {
  constructor(private readonly database: PrismaService) {}

  /** Opens a new round for `farmId` and assigns it; returns the round id. */
  async openRound(
    tx: Prisma.TransactionClient,
    farmId: string,
    preferredAgentId?: string | null,
  ): Promise<string> {
    const { id } = await tx.farmVerification.create({
      data: { farmId },
      select: { id: true },
    });
    await this.assign(tx, id, preferredAgentId);
    return id;
  }

  /**
   * Assigns an UNASSIGNED round to a verified agent in its farm's LGA, or
   * leaves it for the retry job. Returns the agent id, or null.
   */
  async assign(
    tx: Prisma.TransactionClient,
    roundId: string,
    preferredAgentId?: string | null,
  ): Promise<string | null> {
    const round = await tx.farmVerification.findUnique({
      where: { id: roundId },
      select: { farm: { select: { lgaId: true } } },
    });
    if (!round) {
      return null;
    }
    const { lgaId } = round.farm;
    // Serialises assignment per LGA: without it, two farms created at once
    // in one LGA both read the same "smallest cluster" and land on the same
    // agent.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lga:${lgaId}`}, 0))`;

    const agents = await tx.agent.findMany({
      where: {
        isVerified: true,
        lgaId,
        declines: { none: { verificationId: roundId } },
      },
      select: {
        id: true,
        createdAt: true,
        cluster: { select: { _count: { select: { farms: true } } } },
        _count: {
          select: {
            verifications: { where: { status: { in: OPEN_TASK_STATUSES } } },
          },
        },
      },
    });
    const agentId = pickAgent(
      agents.map((agent) => ({
        id: agent.id,
        createdAt: agent.createdAt,
        clusterSize: agent.cluster?._count.farms ?? 0,
        openTasks: agent._count.verifications,
      })),
      preferredAgentId,
    );
    if (!agentId) {
      return null;
    }
    // Guarded on UNASSIGNED so a round the retry job and a decline reach at
    // the same moment is only assigned once.
    const { count } = await tx.farmVerification.updateMany({
      where: { id: roundId, status: VerificationTaskStatus.UNASSIGNED },
      data: { agentId, status: VerificationTaskStatus.ASSIGNED },
    });
    return count ? agentId : null;
  }

  /**
   * Returns a round to UNASSIGNED with nothing recorded. Returns the storage
   * keys of its deleted evidence for the caller to remove after commit.
   */
  async resetRound(
    tx: Prisma.TransactionClient,
    roundId: string,
  ): Promise<string[]> {
    const evidence = await tx.verificationEvidence.findMany({
      where: { verificationId: roundId },
      select: { storageKey: true },
    });
    await tx.verificationEvidence.deleteMany({
      where: { verificationId: roundId },
    });
    await tx.verificationCheck.deleteMany({
      where: { verificationId: roundId },
    });
    await tx.farmVerification.update({
      where: { id: roundId },
      data: CLEARED_ROUND,
    });
    return evidence.map(({ storageKey }) => storageKey);
  }

  /** The retry job: one transaction per waiting round, oldest first. */
  async assignWaiting(): Promise<number> {
    const rounds = await this.database.farmVerification.findMany({
      where: { status: VerificationTaskStatus.UNASSIGNED },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    let assigned = 0;
    for (const { id } of rounds) {
      const agentId = await this.database.$transaction((tx) =>
        this.assign(tx, id),
      );
      if (agentId) {
        assigned += 1;
      }
    }
    return assigned;
  }
}
