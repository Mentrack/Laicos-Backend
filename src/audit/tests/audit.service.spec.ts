import { NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit.service';

const profile = {
  id: 'event-1',
  occurredAt: new Date('2026-10-09T08:00:00.000Z'),
  category: AuditCategory.PROFILE,
  title: 'Profile updated',
  summary: 'first name',
  actionLabel: 'View profile',
  resource: AuditResource.FARMER,
  resourceId: 'farmer-1',
  farmId: null,
};
const payout = {
  id: 'event-2',
  occurredAt: new Date('2026-10-08T08:00:00.000Z'),
  category: AuditCategory.PAYOUT,
  title: 'Payout PO-000001 paid',
  summary: '₦1200.00 to GTBank',
  actionLabel: 'View payout',
  resource: AuditResource.PAYOUT,
  resourceId: 'payout-1',
  farmId: null,
};
const farmEvent = {
  id: 'event-3',
  occurredAt: new Date('2026-10-10T08:00:00.000Z'),
  category: AuditCategory.FARM,
  title: 'Farm LF-000001 updated',
  summary: 'Green Acres',
  actionLabel: 'View farm',
  resource: AuditResource.FARM,
  resourceId: 'farm-1',
  farmId: 'farm-1',
};
const removed = {
  id: 'event-4',
  occurredAt: new Date('2026-10-07T08:00:00.000Z'),
  category: AuditCategory.LISTING,
  title: 'Listing removed',
  summary: 'Maize on LF-000001',
  actionLabel: null,
  resource: null,
  resourceId: null,
  farmId: 'farm-1',
};

describe('AuditService', () => {
  const auditEvent = {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  };
  const farmer = { findUnique: jest.fn() };
  const agent = { findUnique: jest.fn() };
  const farm = { findFirst: jest.fn(), findUnique: jest.fn() };
  const database = { auditEvent, farmer, agent, farm };
  const service = new AuditService(database as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('returns a farmer’s rows newest first, including profile and payout', async () => {
    farmer.findUnique.mockResolvedValue({ id: 'farmer-1' });
    auditEvent.findMany.mockResolvedValue([farmEvent, profile, payout]);
    auditEvent.count.mockResolvedValue(3);

    const result = await service.findForFarmer('farmer-1', {});

    expect(auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { farmerId: 'farmer-1' },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.data.map((row) => row.id)).toEqual([
      'event-3',
      'event-1',
      'event-2',
    ]);
    expect(result.data[1].action).toEqual({
      label: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: 'farmer-1',
    });
    expect(result.metaData).toEqual({
      page: 1,
      perPage: 20,
      total: 3,
      totalPages: 1,
    });
  });

  it('limits a farmer list to one farm and drops profile and payout rows', async () => {
    farmer.findUnique.mockResolvedValue({ id: 'farmer-1' });
    farm.findFirst.mockResolvedValue({ id: 'farm-1' });
    auditEvent.findMany.mockResolvedValue([farmEvent]);
    auditEvent.count.mockResolvedValue(1);

    await service.findForFarmer('farmer-1', { farmId: 'farm-1' });

    expect(farm.findFirst).toHaveBeenCalledWith({
      where: { id: 'farm-1', ownerId: 'farmer-1' },
      select: { id: true },
    });
    expect(auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { farmerId: 'farmer-1', farmId: 'farm-1' },
      }),
    );
  });

  it('404s a farm owned by someone else', async () => {
    farmer.findUnique.mockResolvedValue({ id: 'farmer-1' });
    farm.findFirst.mockResolvedValue(null);

    await expect(
      service.findForFarmer('farmer-1', { farmId: 'farm-9' }),
    ).rejects.toThrow(new NotFoundException('Farm not found'));
    expect(auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('404s a missing farmer and a missing agent', async () => {
    farmer.findUnique.mockResolvedValue(null);
    agent.findUnique.mockResolvedValue(null);
    await expect(service.findForFarmer('missing', {})).rejects.toThrow(
      new NotFoundException('Farmer not found'),
    );
    await expect(service.findForAgent('missing', {})).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
  });

  it('returns an empty page when an agent never touched a real farm', async () => {
    agent.findUnique.mockResolvedValue({ id: 'agent-1' });
    farm.findUnique.mockResolvedValue({ id: 'farm-1' });
    auditEvent.findMany.mockResolvedValue([]);
    auditEvent.count.mockResolvedValue(0);

    const result = await service.findForAgent('agent-1', { farmId: 'farm-1' });

    expect(result.data).toEqual([]);
    expect(farm.findUnique).toHaveBeenCalledWith({
      where: { id: 'farm-1' },
      select: { id: true },
    });
  });

  it('404s an agent filter for a missing farm', async () => {
    agent.findUnique.mockResolvedValue({ id: 'agent-1' });
    farm.findUnique.mockResolvedValue(null);
    await expect(
      service.findForAgent('agent-1', { farmId: 'missing' }),
    ).rejects.toThrow(new NotFoundException('Farm not found'));
  });

  it('maps a row with no link to a null action', async () => {
    farmer.findUnique.mockResolvedValue({ id: 'farmer-1' });
    auditEvent.findMany.mockResolvedValue([removed]);
    auditEvent.count.mockResolvedValue(1);
    const result = await service.findForFarmer('farmer-1', {});
    expect(result.data[0].action).toBeNull();
  });

  it('inserts the event on the transaction client', async () => {
    const tx = { auditEvent: { create: jest.fn() } };
    const event = {
      actorType: AuditActorType.FARMER,
      farmerId: 'farmer-1',
      agentId: null,
      farmId: null,
      category: AuditCategory.PROFILE,
      title: 'Profile updated',
      summary: 'ID details',
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: 'farmer-1',
    };
    await service.record(tx as never, event);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: event });
  });
});
