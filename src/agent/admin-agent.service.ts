import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  Prisma,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { webappUrl } from '../common/config';
import type { CountDto } from '../common/dto/count.dto';
import {
  type PaginationMetaDto,
  type PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../common/pagination';
import type { LgaDto, StateDto } from '../location/dto';
import type { AdminFarmRowDto } from '../farm/dto/admin-farm.dto';
import { AdminFarmService } from '../farm/services/admin-farm.service';
import { MailService } from '../mail/mail.service';
import {
  accountVerifiedEmail,
  agentReinstatedEmail,
  agentRejectedEmail,
  agentSuspendedEmail,
  type RenderedEmail,
} from '../mail/templates';
import { OPEN_SOURCING_REQUEST } from '../sourcing-request/utils/sourcing-rules';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type {
  AdminAgentDetailDto,
  AdminAgentListItemDto,
  AdminAgentLocationQueryDto,
  AdminAgentQueryDto,
  AdminAgentSummaryDto,
  PendingAgentDto,
  RejectAgentDto,
  SuspendAgentDto,
  VerificationMixDto,
} from './dto';
import {
  AGENT_LIST_SELECT,
  AGENT_LOCATION_SELECT,
  type AgentListRow,
  toAdminAgentListItem,
  verificationStatus,
} from './formatters/admin-agent-list.formatter';
import { agentListWhere, PENDING_AGENT } from './utils/agent-list-filter';
import {
  currentlySuspendedWhere,
  isCurrentlySuspended,
  notCurrentlySuspendedWhere,
} from './utils/agent-suspension';

const PENDING_SELECT = {
  id: true,
  agentId: true,
  createdAt: true,
  ...AGENT_LOCATION_SELECT,
  user: {
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.AgentSelect;

const DETAIL_SELECT = {
  ...PENDING_SELECT,
  userId: true,
  organisation: true,
  idType: true,
  idNumber: true,
  idDocumentKey: true,
  professionalCertificateKey: true,
  bankStatementKey: true,
  isVerified: true,
  verifiedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  suspendedAt: true,
  suspendedUntil: true,
  suspensionReason: true,
  cluster: {
    select: {
      id: true,
      name: true,
      clusterCode: true,
      _count: { select: { farms: true } },
    },
  },
} satisfies Prisma.AgentSelect;

type PendingAgentRow = Prisma.AgentGetPayload<{
  select: typeof PENDING_SELECT;
}>;
type AgentDetailRow = Prisma.AgentGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

function toPendingAgent({
  id,
  agentId,
  createdAt,
  state,
  lga,
  user,
}: PendingAgentRow): PendingAgentDto {
  return { id, agentId, ...user, state, lga, submittedAt: createdAt };
}

const MIX_KEYS = {
  [FarmVerificationStatus.VERIFIED]: 'verified',
  [FarmVerificationStatus.PENDING]: 'pending',
  [FarmVerificationStatus.REJECTED]: 'rejected',
  [FarmVerificationStatus.SUSPENDED]: 'suspended',
} as const satisfies Record<FarmVerificationStatus, keyof VerificationMixDto>;

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row] as const));
}

@Injectable()
export class AdminAgentService {
  private readonly logger = new Logger(AdminAgentService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly farms: AdminFarmService,
  ) {}

  async findAll(
    query: AdminAgentQueryDto,
  ): Promise<{ data: AdminAgentListItemDto[]; metaData: PaginationMetaDto }> {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = agentListWhere(query);
    const [users, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        select: AGENT_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.database.user.count({ where }),
    ]);
    const { states, lgas } = await this.applicationLocations(users);
    return {
      data: users.map((row) => toAdminAgentListItem(row, states, lgas)),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async summary(
    query: AdminAgentLocationQueryDto,
  ): Promise<AdminAgentSummaryDto> {
    const now = new Date();
    const agent = {
      isVerified: true,
      ...(query.stateId && { stateId: query.stateId }),
      ...(query.lgaId && { lgaId: query.lgaId }),
    } satisfies Prisma.AgentWhereInput;
    const [activeAgents, activeClusters, assignedFarms, requests] =
      await this.database.$transaction([
        this.database.agent.count({
          where: { ...agent, ...notCurrentlySuspendedWhere(now) },
        }),
        this.database.cluster.count({ where: { agent } }),
        this.database.farm.count({ where: { cluster: { agent } } }),
        this.database.sourcingRequest.aggregate({
          where: { ...OPEN_SOURCING_REQUEST, assignedAgent: agent },
          _count: true,
          _min: { requiredDate: true },
        }),
      ]);
    return {
      activeAgents,
      activeClusters,
      assignedFarms,
      pendingRequests: requests._count,
      earliestRequiredDate: requests._min.requiredDate,
    };
  }

  async findPending(query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const [agents, total] = await this.database.$transaction([
      this.database.agent.findMany({
        where: PENDING_AGENT,
        select: PENDING_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.database.agent.count({ where: PENDING_AGENT }),
    ]);
    return {
      data: agents.map(toPendingAgent),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async countPending(): Promise<CountDto> {
    return { total: await this.database.agent.count({ where: PENDING_AGENT }) };
  }

  async findOne(id: string): Promise<AdminAgentDetailDto> {
    const now = new Date();
    const agent = await this.requireAgent(this.database, id);
    const keys = [
      agent.idDocumentKey,
      agent.professionalCertificateKey,
      agent.bankStatementKey,
    ];
    const [urls, verificationMix, lastActivity] = await Promise.all([
      Promise.all(keys.map((key) => this.storage.presignedUrlOrNull(key))),
      this.verificationMix(agent.cluster?.id),
      this.database.auditEvent.findFirst({
        where: { agentId: id, actorType: AuditActorType.EXTENSION_AGENT },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
    ]);
    const [idDocumentUrl, professionalCertificateUrl, bankStatementUrl] = urls;
    // An expired suspension the sweep hasn't reached yet reads as not suspended.
    const suspended = isCurrentlySuspended(agent, now);
    return {
      ...toPendingAgent(agent),
      organisation: agent.organisation,
      idType: agent.idType,
      idNumber: agent.idNumber,
      idDocumentUrl,
      professionalCertificateUrl,
      bankStatementUrl,
      documentsUploaded: keys.filter(Boolean).length,
      status: verificationStatus(agent, now),
      verifiedAt: agent.verifiedAt,
      rejectedAt: agent.rejectedAt,
      rejectionReason: agent.rejectionReason,
      suspendedAt: suspended ? agent.suspendedAt : null,
      suspendedUntil: suspended ? agent.suspendedUntil : null,
      suspensionReason: suspended ? agent.suspensionReason : null,
      lastActivityAt: lastActivity?.occurredAt ?? null,
      verificationMix,
      cluster: agent.cluster && {
        id: agent.cluster.id,
        name: agent.cluster.name,
        clusterCode: agent.cluster.clusterCode,
        farmCount: agent.cluster._count.farms,
      },
    };
  }

  async findFarms(
    id: string,
    query: PaginationQueryDto,
  ): Promise<{ data: AdminFarmRowDto[]; metaData: PaginationMetaDto }> {
    const agent = await this.requireAgent(this.database, id);
    if (!agent.cluster) {
      const { page, perPage } = resolvePagination(query);
      return { data: [], metaData: paginationMeta(page, perPage, 0) };
    }
    return this.farms.findInCluster(agent.cluster.id, query);
  }

  async approve(admin: User, id: string): Promise<AdminAgentDetailDto> {
    const agent = await this.database.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await this.claim(tx, id, {
        isVerified: true,
        verifiedAt: now,
      });
      // Only where still null: an agent activated some other way keeps the
      // original time.
      await tx.user.updateMany({
        where: { id: claimed.userId, activatedAt: null },
        data: { activatedAt: now },
      });
      await this.recordDecision(tx, admin, claimed, 'Agent approved', null);
      return claimed;
    });
    await this.notify(
      agent,
      accountVerifiedEmail({
        firstName: agent.user.firstName,
        loginUrl: webappUrl(this.config, '/login'),
      }),
    );
    return this.findOne(id);
  }

  async reject(
    admin: User,
    id: string,
    dto: RejectAgentDto,
  ): Promise<AdminAgentDetailDto> {
    const agent = await this.database.$transaction(async (tx) => {
      const claimed = await this.claim(tx, id, {
        rejectedAt: new Date(),
        rejectionReason: dto.reason,
      });
      await this.recordDecision(
        tx,
        admin,
        claimed,
        'Agent rejected',
        dto.reason,
      );
      return claimed;
    });
    await this.notify(
      agent,
      agentRejectedEmail({
        firstName: agent.user.firstName,
        reason: dto.reason,
      }),
    );
    return this.findOne(id);
  }

  async suspend(
    admin: User,
    id: string,
    dto: SuspendAgentDto,
  ): Promise<AdminAgentDetailDto> {
    const now = new Date();
    const until = dto.until ?? null;
    if (until && until <= now) {
      throw new BadRequestException('Suspension end must be in the future');
    }
    const agent = await this.database.$transaction(async (tx) => {
      const current = await this.requireAgent(tx, id);
      // Close out an expired suspension the sweep hasn't reached yet, so its
      // end is audited before the new suspension overwrites it. No reinstated
      // email: the suspended one follows straight away.
      if (current.suspendedAt && !isCurrentlySuspended(current, now)) {
        await this.endExpiredSuspension(tx, current);
      }
      // Guarded on the state so two admins acting at once can't both win.
      const { count } = await tx.agent.updateMany({
        where: {
          id,
          isVerified: true,
          rejectedAt: null,
          ...notCurrentlySuspendedWhere(now),
        },
        data: {
          suspendedAt: now,
          suspendedUntil: until,
          suspensionReason: dto.reason,
        },
      });
      if (!count) {
        const latest = await this.requireAgent(tx, id);
        throw new ConflictException(
          isCurrentlySuspended(latest, now)
            ? 'Agent is already suspended'
            : 'Only a verified agent can be suspended',
        );
      }
      await this.recordDecision(
        tx,
        admin,
        current,
        'Agent suspended',
        until ? `${dto.reason} (until ${until.toISOString()})` : dto.reason,
      );
      return current;
    });
    await this.notify(
      agent,
      agentSuspendedEmail({
        firstName: agent.user.firstName,
        reason: dto.reason,
        until,
      }),
    );
    return this.findOne(id);
  }

  async unsuspend(admin: User, id: string): Promise<AdminAgentDetailDto> {
    const now = new Date();
    const agent = await this.database.$transaction(async (tx) => {
      const current = await this.requireAgent(tx, id);
      // Guarded on the state so two admins acting at once can't both win.
      const { count } = await tx.agent.updateMany({
        where: { id, ...currentlySuspendedWhere(now) },
        data: {
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      if (!count) {
        throw new ConflictException('Agent is not suspended');
      }
      await this.recordDecision(tx, admin, current, 'Agent unsuspended', null);
      return current;
    });
    await this.notify(
      agent,
      agentReinstatedEmail({
        firstName: agent.user.firstName,
        loginUrl: webappUrl(this.config, '/login'),
      }),
    );
    return this.findOne(id);
  }

  // Access already returns once the end passes; this tidies the fields,
  // audits and sends the email. One transaction per row so a bad row can't
  // roll back the others.
  async endExpiredSuspensions(now: Date = new Date()): Promise<number> {
    const expired = await this.database.agent.findMany({
      where: { suspendedAt: { not: null }, suspendedUntil: { lte: now } },
      select: DETAIL_SELECT,
    });
    let ended = 0;
    for (const agent of expired) {
      const closed = await this.database.$transaction((tx) =>
        this.endExpiredSuspension(tx, agent),
      );
      if (!closed) continue;
      ended += 1;
      await this.notify(
        agent,
        agentReinstatedEmail({
          firstName: agent.user.firstName,
          loginUrl: webappUrl(this.config, '/login'),
        }),
      );
    }
    return ended;
  }

  // Guarded on the suspension as read, so the sweep and a concurrent suspend
  // can't both close it out and audit it twice.
  private async endExpiredSuspension(
    tx: Prisma.TransactionClient,
    agent: AgentDetailRow,
  ): Promise<boolean> {
    const { count } = await tx.agent.updateMany({
      where: {
        id: agent.id,
        suspendedAt: agent.suspendedAt,
        suspendedUntil: agent.suspendedUntil,
      },
      data: { suspendedAt: null, suspendedUntil: null, suspensionReason: null },
    });
    if (!count) return false;
    await this.recordDecision(tx, null, agent, 'Agent suspension ended', null);
    return true;
  }

  // Application.stateId/lgaId have no relation, so onboarding rows' names are
  // looked up here, one query each for the whole page.
  private async applicationLocations(users: AgentListRow[]) {
    const onboarding = users.filter((row) => !row.agent);
    const ids = (pick: (row: AgentListRow) => string | null | undefined) => [
      ...new Set(onboarding.map(pick).filter((id): id is string => !!id)),
    ];
    const stateIds = ids((row) => row.application?.stateId);
    const lgaIds = ids((row) => row.application?.lgaId);
    const [states, lgas] = await Promise.all([
      stateIds.length
        ? this.database.state.findMany({
            where: { id: { in: stateIds } },
            select: AGENT_LOCATION_SELECT.state.select,
          })
        : [],
      lgaIds.length
        ? this.database.lga.findMany({
            where: { id: { in: lgaIds } },
            select: AGENT_LOCATION_SELECT.lga.select,
          })
        : [],
    ]);
    return { states: byId<StateDto>(states), lgas: byId<LgaDto>(lgas) };
  }

  private async verificationMix(
    clusterId: string | undefined,
  ): Promise<VerificationMixDto> {
    const mix = { verified: 0, pending: 0, rejected: 0, suspended: 0 };
    if (!clusterId) return mix;
    const groups = await this.database.farm.groupBy({
      by: ['verificationStatus'],
      where: { clusterId },
      _count: true,
    });
    for (const group of groups) {
      mix[MIX_KEYS[group.verificationStatus]] = group._count;
    }
    return mix;
  }

  private async requireAgent(
    client: Prisma.TransactionClient,
    id: string,
  ): Promise<AgentDetailRow> {
    const agent = await client.agent.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
    return agent;
  }

  // Guarded on PENDING so two admins deciding at once can't both win.
  private async claim(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.AgentUpdateManyMutationInput,
  ): Promise<AgentDetailRow> {
    const { count } = await tx.agent.updateMany({
      where: { id, ...PENDING_AGENT },
      data,
    });
    const agent = await this.requireAgent(tx, id);
    if (!count) {
      throw new ConflictException(
        agent.rejectedAt
          ? 'Agent was already rejected'
          : 'Agent is already verified',
      );
    }
    return agent;
  }

  // A null actor is the system, e.g. closing out an expired suspension.
  private recordDecision(
    tx: Prisma.TransactionClient,
    actor: User | null,
    agent: AgentDetailRow,
    title: string,
    detail: string | null,
  ): Promise<void> {
    const who = `${agent.user.firstName} ${agent.user.lastName} (${agent.agentId})`;
    return this.audit.record(tx, {
      actorType: actor ? AuditActorType.ADMIN : AuditActorType.SYSTEM,
      actorUserId: actor?.id ?? null,
      farmerId: null,
      agentId: agent.id,
      farmId: null,
      category: AuditCategory.VERIFICATION,
      title,
      summary: detail ? `${who}: ${detail}` : who,
      actionLabel: 'View profile',
      resource: AuditResource.AGENT,
      resourceId: agent.id,
    });
  }

  // After commit, so a failed email never undoes the decision.
  private async notify(
    agent: AgentDetailRow,
    email: RenderedEmail,
  ): Promise<void> {
    await this.mail.send(agent.user.email, email).catch((error) => {
      this.logger.error(
        `Decision email not sent to agent ${agent.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
