import {
  AuditActorType,
  AuditCategory,
  NotificationType,
  SourcingRequestStatus,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SourcingConfig } from '../sourcing-config';
import { SourcingResponseService } from '../sourcing-response.service';

const now = new Date('2026-11-18T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    requestNumber: 'REQ-000001',
    status: SourcingRequestStatus.ASSIGNED,
    assignedAgentId: 'agent-1',
    assignedAt: hoursAgo(25),
    buyer: { userId: 'buyer-user-1' },
    ...overrides,
  };
}

describe('SourcingResponseService', () => {
  const sourcingRequest = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const sourcingDecline = { create: jest.fn() };
  const tx = { $executeRaw: jest.fn(), sourcingRequest, sourcingDecline };
  const database = {
    sourcingRequest,
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const notifications = { notify: jest.fn(), dispatch: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new SourcingResponseService(
    database as unknown as PrismaService,
    { responseHours: 24 } as SourcingConfig,
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    notifications.notify.mockResolvedValue(['delivery-1']);
  });

  it('scans for ASSIGNED requests older than the response window', async () => {
    sourcingRequest.findMany.mockResolvedValue([]);
    await service.expireOverdue(now);
    expect(sourcingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: SourcingRequestStatus.ASSIGNED,
          assignedAt: { lt: hoursAgo(24) },
        },
      }),
    );
  });

  it('returns a 25-hour-old request to PENDING and emails the buyer', async () => {
    sourcingRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);
    sourcingRequest.findUnique.mockResolvedValue(requestRow());

    await expect(service.expireOverdue(now)).resolves.toBe(1);

    expect(sourcingDecline.create).toHaveBeenCalledWith({
      data: {
        sourcingRequestId: 'request-1',
        agentId: 'agent-1',
        reason: null,
      },
    });
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: SourcingRequestStatus.PENDING },
    });
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { assignedAgentId: null, assignedAt: null },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      {
        userIds: ['buyer-user-1'],
        type: NotificationType.SOURCING_UNANSWERED,
        params: {
          requestId: 'request-1',
          requestNumber: 'REQ-000001',
          responseHours: 24,
        },
      },
      tx,
    );
    expect(notifications.dispatch).toHaveBeenCalledWith(['delivery-1']);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorType: AuditActorType.SYSTEM,
        actorUserId: null,
        // AuditEvent_actor_check rejects a SYSTEM row that names an agent.
        agentId: null,
        category: AuditCategory.SOURCING,
        title: 'Request returned to the pool',
        summary: 'Response window expired',
        sourcingRequestId: 'request-1',
      }),
    );
  });

  it('leaves a request accepted between the scan and the lock', async () => {
    sourcingRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);
    sourcingRequest.findUnique.mockResolvedValue(
      requestRow({ status: SourcingRequestStatus.FINDING_SUPPLY }),
    );

    await expect(service.expireOverdue(now)).resolves.toBe(0);

    expect(sourcingRequest.update).not.toHaveBeenCalled();
    expect(sourcingDecline.create).not.toHaveBeenCalled();
    expect(notifications.dispatch).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('leaves a request reassigned (window restarted) after the scan', async () => {
    sourcingRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);
    sourcingRequest.findUnique.mockResolvedValue(
      requestRow({ assignedAt: hoursAgo(1) }),
    );

    await expect(service.expireOverdue(now)).resolves.toBe(0);
    expect(sourcingRequest.update).not.toHaveBeenCalled();
  });

  it('leaves a request still inside the window when re-read under the lock', async () => {
    sourcingRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);
    sourcingRequest.findUnique.mockResolvedValue(
      requestRow({ assignedAt: hoursAgo(23) }),
    );

    await expect(service.expireOverdue(now)).resolves.toBe(0);
    expect(sourcingRequest.update).not.toHaveBeenCalled();
    expect(sourcingDecline.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('logs one failure and carries on with the batch', async () => {
    sourcingRequest.findMany.mockResolvedValue([
      { id: 'request-1' },
      { id: 'request-2' },
    ]);
    sourcingRequest.findUnique.mockImplementation(
      (args: { where: { id: string } }) =>
        args.where.id === 'request-1'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(requestRow({ id: args.where.id })),
    );

    await expect(service.expireOverdue(now)).resolves.toBe(1);
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-2' },
      data: { status: SourcingRequestStatus.PENDING },
    });
  });
});
