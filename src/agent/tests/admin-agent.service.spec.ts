import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  type User,
} from '../../../generated/client';
import { AdminFarmService } from '../../farm/services/admin-farm.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OPEN_SOURCING_REQUEST } from '../../sourcing-request/utils/sourcing-rules';
import { AdminAgentService } from '../admin-agent.service';
import { AgentVerificationStatus } from '../dto';
import { agentListWhere } from '../utils/agent-list-filter';
import {
  currentlySuspendedWhere,
  notCurrentlySuspendedWhere,
} from '../utils/agent-suspension';

const submitted = new Date('2026-10-02T09:00:00.000Z');
const agentId = '5b1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const admin = { id: 'admin-1' } as User;
const PENDING = { isVerified: false, rejectedAt: null };

const joined = new Date('2026-09-15T08:00:00.000Z');

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    firstName: 'Halima',
    lastName: 'Bello',
    email: 'halima@example.com',
    phoneNumber: '+2348012345678',
    avatarUrl: null,
    createdAt: joined,
    agent: {
      id: 'agent-1',
      agentId: 'AG-000001',
      isVerified: true,
      rejectedAt: null,
      suspendedAt: null,
      suspendedUntil: null,
      state: { id: 'state-1', name: 'Kano' },
      lga: { id: 'lga-1', stateId: 'state-1', name: 'Nassarawa' },
      cluster: { _count: { farms: 7 } },
      _count: { assignedSourcingRequests: 2 },
    },
    application: { stateId: 'state-1', lgaId: 'lga-1' },
    ...overrides,
  };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    agentId: 'AG-000001',
    createdAt: submitted,
    state: { id: 'state-1', name: 'Kano' },
    lga: { id: 'lga-1', stateId: 'state-1', name: 'Nassarawa' },
    user: {
      firstName: 'Musa',
      lastName: 'Bello',
      email: 'musa@example.com',
      phoneNumber: '+2348012345678',
      avatarUrl: null,
    },
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...pendingRow({ id: agentId }),
    userId: 'user-1',
    organisation: 'Kano State Extension Office',
    idType: 'NIN',
    idNumber: '12345678901',
    idDocumentKey: 'agents/id.pdf',
    professionalCertificateKey: 'agents/cert.pdf',
    bankStatementKey: null,
    isVerified: false,
    verifiedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    cluster: {
      id: 'cluster-1',
      name: 'Nassarawa Hub',
      clusterCode: 'CL-000001',
      _count: { farms: 4 },
    },
    ...overrides,
  };
}

describe('AdminAgentService', () => {
  const agent = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  };
  const user = {
    updateMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const cluster = { count: jest.fn() };
  const farm = { count: jest.fn(), groupBy: jest.fn() };
  const auditEvent = { findFirst: jest.fn() };
  const farms = { findInCluster: jest.fn() };
  const sourcingRequest = { aggregate: jest.fn() };
  const state = { findMany: jest.fn() };
  const lga = { findMany: jest.fn() };
  const database = {
    agent,
    user,
    cluster,
    farm,
    auditEvent,
    sourcingRequest,
    state,
    lga,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(database)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const storage = {
    presignedUrlOrNull: jest.fn((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    ),
  };
  const audit = { record: jest.fn() };
  const mail = { send: jest.fn() };
  const config = {
    get: jest.fn(() => 'https://app.laicos.test'),
    getOrThrow: jest.fn(() => 'https://app.laicos.test'),
  };
  const service = new AdminAgentService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    config as unknown as ConfigService,
    farms as unknown as AdminFarmService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    agent.findMany.mockResolvedValue([pendingRow()]);
    agent.count.mockResolvedValue(1);
    agent.findUnique.mockResolvedValue(detailRow());
    agent.updateMany.mockResolvedValue({ count: 1 });
    user.updateMany.mockResolvedValue({ count: 1 });
    mail.send.mockResolvedValue(undefined);
    farm.groupBy.mockResolvedValue([]);
    auditEvent.findFirst.mockResolvedValue(null);
  });

  describe('summary', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    const earliest = new Date('2026-11-01T00:00:00.000Z');
    const summaryNow = new Date('2026-11-12T10:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: summaryNow });
      agent.count.mockResolvedValue(18);
      cluster.count.mockResolvedValue(18);
      farm.count.mockResolvedValue(142);
      sourcingRequest.aggregate.mockResolvedValue({
        _count: 12,
        _min: { requiredDate: earliest },
      });
    });

    it('scopes every count to verified agents in the area', async () => {
      await service.summary({ stateId: 's1' });

      const scoped = { isVerified: true, stateId: 's1' };
      expect(agent.count).toHaveBeenCalledWith({
        where: { ...scoped, ...notCurrentlySuspendedWhere(summaryNow) },
      });
      expect(cluster.count).toHaveBeenCalledWith({ where: { agent: scoped } });
      expect(farm.count).toHaveBeenCalledWith({
        where: { cluster: { agent: scoped } },
      });
      expect(sourcingRequest.aggregate).toHaveBeenCalledWith({
        where: { ...OPEN_SOURCING_REQUEST, assignedAgent: scoped },
        _count: true,
        _min: { requiredDate: true },
      });
    });

    it('returns the counts and earliest date', async () => {
      await expect(service.summary({})).resolves.toEqual({
        activeAgents: 18,
        activeClusters: 18,
        assignedFarms: 142,
        pendingRequests: 12,
        earliestRequiredDate: earliest,
      });
    });

    it('earliestRequiredDate is null with no open requests', async () => {
      sourcingRequest.aggregate.mockResolvedValue({
        _count: 0,
        _min: { requiredDate: null },
      });

      const result = await service.summary({});

      expect(result.earliestRequiredDate).toBeNull();
    });

    it('omits absent location filters', async () => {
      await service.summary({});

      expect(agent.count).toHaveBeenCalledWith({
        where: { isVerified: true, ...notCurrentlySuspendedWhere(summaryNow) },
      });
    });
  });

  describe('pending', () => {
    it('lists agents neither verified nor rejected, oldest first', async () => {
      const result = await service.findPending({ page: 2, perPage: 10 });

      expect(result).toEqual({
        data: [
          {
            id: 'agent-1',
            agentId: 'AG-000001',
            firstName: 'Musa',
            lastName: 'Bello',
            email: 'musa@example.com',
            phoneNumber: '+2348012345678',
            avatarUrl: null,
            state: { id: 'state-1', name: 'Kano' },
            lga: { id: 'lga-1', stateId: 'state-1', name: 'Nassarawa' },
            submittedAt: submitted,
          },
        ],
        metaData: { page: 2, perPage: 10, total: 1, totalPages: 1 },
      });
      expect(agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: PENDING,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: 10,
          take: 10,
        }),
      );
      expect(agent.count).toHaveBeenCalledWith({ where: PENDING });
    });

    it('counts the same agents', async () => {
      agent.count.mockResolvedValue(6);

      await expect(service.countPending()).resolves.toEqual({ total: 6 });
      expect(agent.count).toHaveBeenCalledWith({ where: PENDING });
    });
  });

  describe('findOne', () => {
    it('returns what the agent submitted with signed document links', async () => {
      await expect(service.findOne(agentId)).resolves.toEqual({
        id: agentId,
        agentId: 'AG-000001',
        firstName: 'Musa',
        lastName: 'Bello',
        email: 'musa@example.com',
        phoneNumber: '+2348012345678',
        avatarUrl: null,
        organisation: 'Kano State Extension Office',
        state: { id: 'state-1', name: 'Kano' },
        lga: { id: 'lga-1', stateId: 'state-1', name: 'Nassarawa' },
        idType: 'NIN',
        idNumber: '12345678901',
        idDocumentUrl: 'https://signed/agents/id.pdf',
        professionalCertificateUrl: 'https://signed/agents/cert.pdf',
        bankStatementUrl: null,
        documentsUploaded: 2,
        submittedAt: submitted,
        status: AgentVerificationStatus.PENDING,
        verifiedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        suspendedAt: null,
        suspendedUntil: null,
        suspensionReason: null,
        lastActivityAt: null,
        verificationMix: { verified: 0, pending: 0, rejected: 0, suspended: 0 },
        cluster: {
          id: 'cluster-1',
          name: 'Nassarawa Hub',
          clusterCode: 'CL-000001',
          farmCount: 4,
        },
      });
    });

    it('counts the cluster farms by verification status', async () => {
      farm.groupBy.mockResolvedValueOnce([
        { verificationStatus: FarmVerificationStatus.VERIFIED, _count: 3 },
        { verificationStatus: FarmVerificationStatus.SUSPENDED, _count: 1 },
      ]);
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        verificationMix: { verified: 3, pending: 0, rejected: 0, suspended: 1 },
      });
      expect(farm.groupBy).toHaveBeenCalledWith({
        by: ['verificationStatus'],
        where: { clusterId: 'cluster-1' },
        _count: true,
      });
    });

    it('skips the farm count and returns zeros without a cluster', async () => {
      agent.findUnique.mockResolvedValueOnce(detailRow({ cluster: null }));
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        verificationMix: { verified: 0, pending: 0, rejected: 0, suspended: 0 },
      });
      expect(farm.groupBy).not.toHaveBeenCalled();
    });

    it("reports the agent's own latest action as lastActivityAt", async () => {
      const at = new Date('2026-11-10T12:00:00.000Z');
      auditEvent.findFirst.mockResolvedValueOnce({ occurredAt: at });
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        lastActivityAt: at,
      });
      expect(auditEvent.findFirst).toHaveBeenCalledWith({
        where: { agentId, actorType: AuditActorType.EXTENSION_AGENT },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      });
    });

    it('shows the suspension while it is current', async () => {
      const start = new Date('2026-11-01T00:00:00.000Z');
      agent.findUnique.mockResolvedValueOnce(
        detailRow({
          isVerified: true,
          suspendedAt: start,
          suspendedUntil: null,
          suspensionReason: 'Missed visits',
        }),
      );
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        suspendedAt: start,
        suspendedUntil: null,
        suspensionReason: 'Missed visits',
      });
    });

    it('shows null suspension fields once the suspension has expired', async () => {
      agent.findUnique.mockResolvedValueOnce(
        detailRow({
          isVerified: true,
          suspendedAt: new Date('2026-10-01T00:00:00.000Z'),
          suspendedUntil: new Date('2026-10-05T00:00:00.000Z'),
          suspensionReason: 'Missed visits',
        }),
      );
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        suspendedAt: null,
        suspendedUntil: null,
        suspensionReason: null,
      });
    });
  });

  describe('findFarms', () => {
    const query = { page: 1, perPage: 20 };

    it('404s for an unknown agent', async () => {
      agent.findUnique.mockResolvedValueOnce(null);
      await expect(service.findFarms(agentId, query)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns an empty page for an agent without a cluster', async () => {
      agent.findUnique.mockResolvedValueOnce(detailRow({ cluster: null }));
      await expect(service.findFarms(agentId, query)).resolves.toEqual({
        data: [],
        metaData: { page: 1, perPage: 20, total: 0, totalPages: 0 },
      });
      expect(farms.findInCluster).not.toHaveBeenCalled();
    });

    it("returns the cluster's farms", async () => {
      const page = { data: [{ id: 'farm-1' }], metaData: { page: 1 } };
      farms.findInCluster.mockResolvedValueOnce(page);
      await expect(service.findFarms(agentId, query)).resolves.toBe(page);
      expect(farms.findInCluster).toHaveBeenCalledWith('cluster-1', query);
    });

    it('derives SUSPENDED for a suspended verified agent', async () => {
      agent.findUnique.mockResolvedValueOnce(
        detailRow({
          isVerified: true,
          suspendedAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
      );
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        status: AgentVerificationStatus.SUSPENDED,
      });
    });

    it('derives VERIFIED and REJECTED', async () => {
      agent.findUnique.mockResolvedValueOnce(
        detailRow({ isVerified: true, verifiedAt: submitted }),
      );
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        status: AgentVerificationStatus.VERIFIED,
      });

      agent.findUnique.mockResolvedValueOnce(
        detailRow({ rejectedAt: submitted, rejectionReason: 'Blurry ID' }),
      );
      await expect(service.findOne(agentId)).resolves.toMatchObject({
        status: AgentVerificationStatus.REJECTED,
        rejectionReason: 'Blurry ID',
      });
    });

    it('404s a missing agent', async () => {
      agent.findUnique.mockResolvedValue(null);
      await expect(service.findOne(agentId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('verifies, activates, audits and emails the agent', async () => {
      await service.approve(admin, agentId);

      expect(agent.updateMany).toHaveBeenCalledWith({
        where: { id: agentId, ...PENDING },
        data: { isVerified: true, verifiedAt: expect.any(Date) },
      });
      expect(user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', activatedAt: null },
        data: { activatedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(database, {
        actorType: AuditActorType.ADMIN,
        actorUserId: 'admin-1',
        farmerId: null,
        agentId,
        farmId: null,
        category: AuditCategory.VERIFICATION,
        title: 'Agent approved',
        summary: 'Musa Bello (AG-000001)',
        actionLabel: 'View profile',
        resource: AuditResource.AGENT,
        resourceId: agentId,
      });
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({ subject: 'You have been verified' }),
      );
    });

    it('409s an agent already verified, without audit or email', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(detailRow({ isVerified: true }));

      await expect(service.approve(admin, agentId)).rejects.toThrow(
        new ConflictException('Agent is already verified'),
      );
      expect(user.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('409s an agent already rejected', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(detailRow({ rejectedAt: submitted }));

      await expect(service.approve(admin, agentId)).rejects.toThrow(
        new ConflictException('Agent was already rejected'),
      );
    });

    it('404s a missing agent', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(null);

      await expect(service.approve(admin, agentId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('keeps the approval when the email fails', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mail.send.mockRejectedValue(new Error('smtp down'));

      await expect(service.approve(admin, agentId)).resolves.toMatchObject({
        id: agentId,
      });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });
  });

  describe('reject', () => {
    it('stores the reason, audits and emails it', async () => {
      await service.reject(admin, agentId, {
        reason: 'ID photo is unreadable',
      });

      expect(agent.updateMany).toHaveBeenCalledWith({
        where: { id: agentId, ...PENDING },
        data: {
          rejectedAt: expect.any(Date),
          rejectionReason: 'ID photo is unreadable',
        },
      });
      expect(user.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        database,
        expect.objectContaining({
          actorType: AuditActorType.ADMIN,
          actorUserId: 'admin-1',
          category: AuditCategory.VERIFICATION,
          title: 'Agent rejected',
          summary: 'Musa Bello (AG-000001): ID photo is unreadable',
          agentId,
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({
          text: expect.stringContaining('ID photo is unreadable'),
        }),
      );
    });

    it('409s an agent who is no longer pending', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(detailRow({ isVerified: true }));

      await expect(
        service.reject(admin, agentId, { reason: 'Too late' }),
      ).rejects.toThrow(new ConflictException('Agent is already verified'));
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    const now = new Date('2026-11-12T10:00:00.000Z');
    const until = new Date('2026-12-01T00:00:00.000Z');
    const verified = { isVerified: true, verifiedAt: submitted };

    beforeEach(() => {
      jest.useFakeTimers({ now });
      agent.findUnique.mockResolvedValue(detailRow(verified));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('suspends a verified agent, audits and emails them', async () => {
      await expect(
        service.suspend(admin, agentId, { reason: 'Repeated no-shows', until }),
      ).resolves.toMatchObject({ id: agentId });

      expect(agent.updateMany).toHaveBeenCalledWith({
        where: {
          id: agentId,
          isVerified: true,
          rejectedAt: null,
          ...notCurrentlySuspendedWhere(now),
        },
        data: {
          suspendedAt: now,
          suspendedUntil: until,
          suspensionReason: 'Repeated no-shows',
        },
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(database, {
        actorType: AuditActorType.ADMIN,
        actorUserId: 'admin-1',
        farmerId: null,
        agentId,
        farmId: null,
        category: AuditCategory.VERIFICATION,
        title: 'Agent suspended',
        summary: `Musa Bello (AG-000001): Repeated no-shows (until ${until.toISOString()})`,
        actionLabel: 'View profile',
        resource: AuditResource.AGENT,
        resourceId: agentId,
      });
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({
          subject: 'Your LAICOS account has been suspended',
          text: expect.stringContaining('Repeated no-shows'),
        }),
      );
    });

    it('suspends until further notice without an end', async () => {
      await service.suspend(admin, agentId, { reason: 'Under review' });

      expect(agent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            suspendedAt: now,
            suspendedUntil: null,
            suspensionReason: 'Under review',
          },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        database,
        expect.objectContaining({
          title: 'Agent suspended',
          summary: 'Musa Bello (AG-000001): Under review',
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({
          text: expect.stringContaining('until further notice'),
        }),
      );
    });

    it.each([[now], [new Date('2026-11-01T00:00:00.000Z')]])(
      '400s an end of %p without writing',
      async (end) => {
        await expect(
          service.suspend(admin, agentId, { reason: 'Late', until: end }),
        ).rejects.toThrow(
          new BadRequestException('Suspension end must be in the future'),
        );
        expect(agent.updateMany).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
        expect(mail.send).not.toHaveBeenCalled();
      },
    );

    it('409s an agent already suspended, without audit or email', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(
        detailRow({
          ...verified,
          suspendedAt: submitted,
          suspendedUntil: until,
        }),
      );

      await expect(
        service.suspend(admin, agentId, { reason: 'Again' }),
      ).rejects.toThrow(new ConflictException('Agent is already suspended'));
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it.each([
      ['pending', {}],
      ['rejected', { rejectedAt: submitted }],
    ])('409s a %s agent', async (_label, overrides) => {
      agent.updateMany.mockResolvedValue({ count: 0 });
      agent.findUnique.mockResolvedValue(detailRow(overrides));

      await expect(
        service.suspend(admin, agentId, { reason: 'No' }),
      ).rejects.toThrow(
        new ConflictException('Only a verified agent can be suspended'),
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('404s a missing agent without writing', async () => {
      agent.findUnique.mockResolvedValue(null);

      await expect(
        service.suspend(admin, agentId, { reason: 'No' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(agent.updateMany).not.toHaveBeenCalled();
    });

    it('closes out an expired, unswept suspension first', async () => {
      agent.findUnique.mockResolvedValue(
        detailRow({
          ...verified,
          suspendedAt: new Date('2026-10-01T00:00:00.000Z'),
          suspendedUntil: new Date('2026-11-01T00:00:00.000Z'),
          suspensionReason: 'Old',
        }),
      );

      await service.suspend(admin, agentId, { reason: 'New' });

      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenNthCalledWith(
        1,
        database,
        expect.objectContaining({
          actorType: AuditActorType.SYSTEM,
          actorUserId: null,
          category: AuditCategory.VERIFICATION,
          title: 'Agent suspension ended',
          summary: 'Musa Bello (AG-000001)',
          resource: AuditResource.AGENT,
        }),
      );
      expect(audit.record).toHaveBeenNthCalledWith(
        2,
        database,
        expect.objectContaining({
          actorType: AuditActorType.ADMIN,
          title: 'Agent suspended',
        }),
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({
          subject: 'Your LAICOS account has been suspended',
        }),
      );
    });

    it('guards the close-out on the suspension it read', async () => {
      const oldStart = new Date('2026-10-01T00:00:00.000Z');
      const oldEnd = new Date('2026-11-01T00:00:00.000Z');
      agent.findUnique.mockResolvedValue(
        detailRow({
          ...verified,
          suspendedAt: oldStart,
          suspendedUntil: oldEnd,
          suspensionReason: 'Old',
        }),
      );

      await service.suspend(admin, agentId, { reason: 'New' });

      expect(agent.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: agentId, suspendedAt: oldStart, suspendedUntil: oldEnd },
        data: {
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      expect(agent.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ suspensionReason: 'New' }),
        }),
      );
    });

    it('writes no ended row when the sweep closed it first', async () => {
      agent.findUnique.mockResolvedValue(
        detailRow({
          ...verified,
          suspendedAt: new Date('2026-10-01T00:00:00.000Z'),
          suspendedUntil: new Date('2026-11-01T00:00:00.000Z'),
        }),
      );
      agent.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.suspend(admin, agentId, { reason: 'New' });

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        database,
        expect.objectContaining({ title: 'Agent suspended' }),
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it('keeps the suspension when the email fails', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mail.send.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.suspend(admin, agentId, { reason: 'No-shows' }),
      ).resolves.toMatchObject({ id: agentId });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });
  });

  describe('unsuspend', () => {
    const now = new Date('2026-11-12T10:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now });
      agent.findUnique.mockResolvedValue(
        detailRow({
          isVerified: true,
          suspendedAt: new Date('2026-11-01T00:00:00.000Z'),
          suspensionReason: 'No-shows',
        }),
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('clears the suspension, audits and emails the agent', async () => {
      await expect(service.unsuspend(admin, agentId)).resolves.toMatchObject({
        id: agentId,
      });

      expect(agent.updateMany).toHaveBeenCalledWith({
        where: { id: agentId, ...currentlySuspendedWhere(now) },
        data: {
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        database,
        expect.objectContaining({
          actorType: AuditActorType.ADMIN,
          actorUserId: 'admin-1',
          category: AuditCategory.VERIFICATION,
          title: 'Agent unsuspended',
          summary: 'Musa Bello (AG-000001)',
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        'musa@example.com',
        expect.objectContaining({
          subject: 'Your LAICOS account is active again',
          text: expect.stringContaining('https://app.laicos.test/login'),
        }),
      );
    });

    it('409s an agent who is not suspended', async () => {
      agent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unsuspend(admin, agentId)).rejects.toThrow(
        new ConflictException('Agent is not suspended'),
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('404s a missing agent', async () => {
      agent.findUnique.mockResolvedValue(null);

      await expect(service.unsuspend(admin, agentId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(agent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('endExpiredSuspensions', () => {
    const now = new Date('2026-11-12T10:00:00.000Z');
    const start = new Date('2026-10-01T00:00:00.000Z');
    const end = new Date('2026-11-12T09:58:00.000Z');

    function expiredRow(id: string, email: string) {
      return detailRow({
        id,
        isVerified: true,
        suspendedAt: start,
        suspendedUntil: end,
        suspensionReason: 'No-shows',
        user: { ...pendingRow().user, email },
      });
    }

    beforeEach(() => {
      agent.findMany.mockResolvedValue([
        expiredRow('agent-a', 'a@example.com'),
        expiredRow('agent-b', 'b@example.com'),
      ]);
    });

    it('finds suspensions whose end has passed', async () => {
      await service.endExpiredSuspensions(now);

      expect(agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { suspendedAt: { not: null }, suspendedUntil: { lte: now } },
        }),
      );
    });

    it('clears each guarded on what it read, audits as system and emails', async () => {
      await expect(service.endExpiredSuspensions(now)).resolves.toBe(2);

      expect(agent.updateMany).toHaveBeenCalledWith({
        where: { id: 'agent-a', suspendedAt: start, suspendedUntil: end },
        data: {
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      expect(database.$transaction).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(database, {
        actorType: AuditActorType.SYSTEM,
        actorUserId: null,
        farmerId: null,
        agentId: 'agent-a',
        farmId: null,
        category: AuditCategory.VERIFICATION,
        title: 'Agent suspension ended',
        summary: 'Musa Bello (AG-000001)',
        actionLabel: 'View profile',
        resource: AuditResource.AGENT,
        resourceId: 'agent-a',
      });
      expect(mail.send).toHaveBeenCalledWith(
        'a@example.com',
        expect.objectContaining({
          subject: 'Your LAICOS account is active again',
          text: expect.stringContaining('https://app.laicos.test/login'),
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        'b@example.com',
        expect.anything(),
      );
    });

    it('skips a row someone else already changed', async () => {
      agent.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.endExpiredSuspensions(now)).resolves.toBe(1);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        database,
        expect.objectContaining({ agentId: 'agent-b' }),
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(
        'b@example.com',
        expect.anything(),
      );
    });

    it('carries on past a failed email', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mail.send.mockRejectedValueOnce(new Error('smtp down'));

      await expect(service.endExpiredSuspensions(now)).resolves.toBe(2);

      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });

    it('returns 0 with nothing expired', async () => {
      agent.findMany.mockResolvedValue([]);

      await expect(service.endExpiredSuspensions(now)).resolves.toBe(0);
      expect(agent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      user.findMany.mockResolvedValue([listRow()]);
      user.count.mockResolvedValue(1);
      state.findMany.mockResolvedValue([]);
      lga.findMany.mockResolvedValue([]);
    });

    it('maps a verified agent row', async () => {
      const { data } = await service.findAll({});

      expect(data).toEqual([
        {
          userId: 'user-1',
          id: 'agent-1',
          agentId: 'AG-000001',
          firstName: 'Halima',
          lastName: 'Bello',
          email: 'halima@example.com',
          phoneNumber: '+2348012345678',
          avatarUrl: null,
          state: { id: 'state-1', name: 'Kano' },
          lga: { id: 'lga-1', stateId: 'state-1', name: 'Nassarawa' },
          status: AgentVerificationStatus.VERIFIED,
          assignedFarms: 7,
          activeClusters: 1,
          pendingRequests: 2,
          createdAt: joined,
        },
      ]);
      expect(state.findMany).not.toHaveBeenCalled();
      expect(lga.findMany).not.toHaveBeenCalled();
    });

    it('maps a suspended verified agent row to SUSPENDED', async () => {
      user.findMany.mockResolvedValue([
        listRow({
          agent: {
            ...listRow().agent,
            suspendedAt: new Date('2026-11-01T00:00:00.000Z'),
            suspendedUntil: null,
          },
        }),
      ]);

      const { data } = await service.findAll({});

      expect(data[0].status).toBe(AgentVerificationStatus.SUSPENDED);
    });

    it('onboarding agent takes location from the application', async () => {
      user.findMany.mockResolvedValue([
        listRow({ agent: null, application: { stateId: 's1', lgaId: 'l1' } }),
      ]);
      state.findMany.mockResolvedValue([{ id: 's1', name: 'Kaduna' }]);
      lga.findMany.mockResolvedValue([
        { id: 'l1', stateId: 's1', name: 'Zaria' },
      ]);

      const { data } = await service.findAll({});

      expect(data[0]).toEqual(
        expect.objectContaining({
          id: null,
          agentId: null,
          status: AgentVerificationStatus.ONBOARDING,
          state: { id: 's1', name: 'Kaduna' },
          lga: { id: 'l1', stateId: 's1', name: 'Zaria' },
          assignedFarms: 0,
          activeClusters: 0,
          pendingRequests: 0,
        }),
      );
      expect(state.findMany).toHaveBeenCalledTimes(1);
      expect(state.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['s1'] } } }),
      );
      expect(lga.findMany).toHaveBeenCalledTimes(1);
      expect(lga.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['l1'] } } }),
      );
    });

    it('legacy agent without an application', async () => {
      user.findMany.mockResolvedValue([
        listRow({
          agent: {
            id: 'agent-2',
            agentId: 'AG-000002',
            isVerified: false,
            rejectedAt: null,
            suspendedAt: null,
            suspendedUntil: null,
            stateId: null,
            state: null,
            lga: null,
            cluster: null,
            _count: { assignedSourcingRequests: 0 },
          },
          application: null,
        }),
      ]);

      const { data } = await service.findAll({});

      expect(data[0]).toEqual(
        expect.objectContaining({
          id: 'agent-2',
          state: null,
          lga: null,
          status: AgentVerificationStatus.PENDING,
          assignedFarms: 0,
          activeClusters: 0,
        }),
      );
    });

    it('orders newest first and paginates', async () => {
      const query = { page: 3, perPage: 5, search: 'halima' };

      const { metaData } = await service.findAll(query);

      expect(user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: agentListWhere(query),
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: 10,
          take: 5,
        }),
      );
      expect(user.count).toHaveBeenCalledWith({ where: agentListWhere(query) });
      expect(metaData).toEqual({
        page: 3,
        perPage: 5,
        total: 1,
        totalPages: 1,
      });
    });

    it('counts only open sourcing requests', async () => {
      await service.findAll({});

      const [[args]] = user.findMany.mock.calls as [
        [{ select: { agent: { select: { _count: { select: unknown } } } } }],
      ];
      expect(args.select.agent.select._count.select).toEqual({
        assignedSourcingRequests: { where: OPEN_SOURCING_REQUEST },
      });
    });
  });
});
