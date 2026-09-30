import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  HandoverStatus,
  ProduceType,
  Role,
  VerificationTaskStatus,
  type User,
} from '../../../generated/client';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AgentService } from '../agent.service';
import { AgentTaskType } from '../dto';

const user = { id: 'user-1', role: Role.EXTENSION_AGENT } as User;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    agentId: 'AG-000044',
    userId: user.id,
    country: 'NG',
    stateId: 'state-1',
    state: { id: 'state-1', name: 'FCT' },
    lgaId: 'lga-1',
    lga: { id: 'lga-1', stateId: 'state-1', name: 'Gwagwalada' },
    idType: null,
    idNumber: null,
    idDocumentKey: null,
    isVerified: false,
    verifiedAt: null,
    cluster: { id: 'cluster-1', name: 'Gwagwalada Hub', _count: { farms: 3 } },
    ...overrides,
  };
}

describe('AgentService', () => {
  const agent = { findUnique: jest.fn(), update: jest.fn() };
  const farm = { findMany: jest.fn(), count: jest.fn() };
  const farmVerification = { findMany: jest.fn() };
  const orderHandover = { findMany: jest.fn() };
  const database = {
    agent,
    farm,
    farmVerification,
    orderHandover,
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const storage = {
    presignedUrlOrNull: jest.fn((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    ),
  };
  const locations = { requireLga: jest.fn() };
  const service = new AgentService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    locations as unknown as LocationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    agent.findUnique.mockResolvedValue(row());
    locations.requireLga.mockResolvedValue({ id: 'lga-2', name: 'Kuje' });
  });

  it('returns the profile with the cluster’s size', async () => {
    await expect(service.findMine(user)).resolves.toMatchObject({
      agentId: 'AG-000044',
      isVerified: false,
      lga: { name: 'Gwagwalada' },
      cluster: { id: 'cluster-1', name: 'Gwagwalada Hub', farmCount: 3 },
      idDocumentUrl: null,
    });
  });

  it('404s a user without an agent profile', async () => {
    agent.findUnique.mockResolvedValue(null);
    await expect(service.findMine(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('moves an unverified agent and renames their cluster after the LGA', async () => {
    await service.updateMine(user, { lgaId: 'lga-2' });
    expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-2');
    expect(agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: {
        idType: undefined,
        idNumber: undefined,
        state: { connect: { id: 'state-1' } },
        lga: { connect: { id: 'lga-2' } },
        cluster: { update: { name: 'Kuje Hub' } },
      },
    });
  });

  it('refuses to move a verified agent to another LGA', async () => {
    agent.findUnique.mockResolvedValue(row({ isVerified: true }));
    await expect(service.updateMine(user, { lgaId: 'lga-2' })).rejects.toThrow(
      new ConflictException('LGA cannot change after verification'),
    );
    expect(agent.update).not.toHaveBeenCalled();
  });

  it('lets a verified agent update their ID details', async () => {
    agent.findUnique.mockResolvedValue(row({ isVerified: true }));
    await service.updateMine(user, { idNumber: '123' });
    expect(agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { idType: undefined, idNumber: '123' },
    });
  });

  it('needs a state to go with a first LGA', async () => {
    agent.findUnique.mockResolvedValue(row({ stateId: null, lgaId: null }));
    await expect(
      service.updateMine(user, { lgaId: 'lga-2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists only farms in the agent’s own cluster', async () => {
    farm.findMany.mockResolvedValue([]);
    farm.count.mockResolvedValue(0);
    await service.findClusterFarms(user, {});
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cluster: { agent: { userId: user.id } } },
      }),
    );
  });

  describe('findTasks', () => {
    const farmRow = {
      id: 'farm-1',
      farmCode: 'LF-000001',
      name: 'Alao Cassava Farm',
      location: 'Sango Community',
      state: { id: 'state-1', name: 'Abia' },
      lga: { id: 'lga-1', stateId: 'state-1', name: 'Aba North' },
      size: 5,
      unit: 'ha',
      mainProduce: 'Cassava',
    };
    const round = {
      id: 'round-1',
      status: VerificationTaskStatus.ASSIGNED,
      startedAt: null,
      decidedAt: null,
      createdAt: new Date('2026-09-01'),
      farm: farmRow,
    };
    const handover = {
      orderId: 'order-1',
      status: HandoverStatus.PENDING,
      verificationNote: null,
      verifiedAt: null,
      recipientName: null,
      recipientPhone: null,
      handoverNote: null,
      handedOverAt: null,
      createdAt: new Date('2026-09-02'),
      order: {
        id: 'order-1',
        orderNumber: 'ORD-000001',
        produceName: 'Maize',
        quantity: 12.5,
        type: ProduceType.LOCAL,
        produce: { unit: 'tons' },
        farm: farmRow,
      },
    };

    beforeEach(() => {
      farmVerification.findMany.mockResolvedValue([round]);
      orderHandover.findMany.mockResolvedValue([handover]);
    });

    it('merges open verifications and handovers, newest first', async () => {
      const { data, metaData } = await service.findTasks(user, {});
      expect(farmVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agent: { userId: user.id },
            status: {
              in: [
                VerificationTaskStatus.ASSIGNED,
                VerificationTaskStatus.IN_PROGRESS,
              ],
            },
          },
        }),
      );
      expect(orderHandover.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agent: { userId: user.id },
            status: { in: [HandoverStatus.PENDING, HandoverStatus.VERIFIED] },
          },
        }),
      );
      expect(data.map(({ type, id }) => [type, id])).toEqual([
        [AgentTaskType.ORDER_HANDOVER, 'order-1'],
        [AgentTaskType.FARM_VERIFICATION, 'round-1'],
      ]);
      expect(data[0]).toMatchObject({
        verification: null,
        handover: { orderNumber: 'ORD-000001', quantity: 12.5, unit: 'tons' },
      });
      expect(data[1]).toMatchObject({
        handover: null,
        verification: { id: 'round-1', farm: { name: 'Alao Cassava Farm' } },
      });
      expect(metaData).toEqual({
        page: 1,
        perPage: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('queries only the requested type', async () => {
      const { data } = await service.findTasks(user, {
        type: AgentTaskType.FARM_VERIFICATION,
      });
      expect(orderHandover.findMany).not.toHaveBeenCalled();
      expect(data).toHaveLength(1);
    });

    it('pages the merged list', async () => {
      const { data, metaData } = await service.findTasks(user, {
        page: 2,
        perPage: 1,
      });
      expect(data.map(({ id }) => id)).toEqual(['round-1']);
      expect(metaData).toEqual({
        page: 2,
        perPage: 1,
        total: 2,
        totalPages: 2,
      });
    });
  });
});
