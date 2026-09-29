import { VerificationTaskStatus, type Prisma } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentService } from '../services/assignment.service';

function candidate(id: string, farms: number, open = 0) {
  return {
    id,
    createdAt: new Date('2026-01-01'),
    cluster: { _count: { farms } },
    _count: { verifications: open },
  };
}

describe('AssignmentService', () => {
  const farmVerification = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const agent = { findMany: jest.fn() };
  const verificationEvidence = { findMany: jest.fn(), deleteMany: jest.fn() };
  const verificationCheck = { deleteMany: jest.fn() };
  const tx = {
    farmVerification,
    agent,
    verificationEvidence,
    verificationCheck,
    $executeRaw: jest.fn(),
  };
  const database = {
    ...tx,
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const service = new AssignmentService(database as unknown as PrismaService);
  const client = tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.resetAllMocks();
    farmVerification.findUnique.mockResolvedValue({
      farm: { lgaId: 'lga-1' },
    });
    farmVerification.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('assign', () => {
    it('locks the LGA and gives the round to the smallest cluster', async () => {
      agent.findMany.mockResolvedValue([
        candidate('busy', 7),
        candidate('light', 2),
      ]);
      await expect(service.assign(client, 'round-1')).resolves.toBe('light');
      const [strings, key] = tx.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        string,
      ];
      expect(strings.join('?')).toContain('pg_advisory_xact_lock');
      expect(key).toBe('lga:lga-1');
      expect(agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isVerified: true,
            lgaId: 'lga-1',
            declines: { none: { verificationId: 'round-1' } },
          },
        }),
      );
      expect(farmVerification.updateMany).toHaveBeenCalledWith({
        where: { id: 'round-1', status: VerificationTaskStatus.UNASSIGNED },
        data: { agentId: 'light', status: VerificationTaskStatus.ASSIGNED },
      });
    });

    it('returns the round to its preferred agent when still eligible', async () => {
      agent.findMany.mockResolvedValue([
        candidate('light', 1),
        candidate('previous', 9),
      ]);
      await expect(service.assign(client, 'round-1', 'previous')).resolves.toBe(
        'previous',
      );
    });

    it('leaves the round waiting when the LGA has no eligible agent', async () => {
      agent.findMany.mockResolvedValue([]);
      await expect(service.assign(client, 'round-1')).resolves.toBeNull();
      expect(farmVerification.updateMany).not.toHaveBeenCalled();
    });

    it('reports nothing when another caller assigned the round first', async () => {
      agent.findMany.mockResolvedValue([candidate('a', 0)]);
      farmVerification.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.assign(client, 'round-1')).resolves.toBeNull();
    });
  });

  it('opens a round and assigns it', async () => {
    farmVerification.create.mockResolvedValue({ id: 'round-1' });
    agent.findMany.mockResolvedValue([candidate('a', 0)]);
    await expect(service.openRound(client, 'farm-1')).resolves.toBe('round-1');
    expect(farmVerification.create).toHaveBeenCalledWith({
      data: { farmId: 'farm-1' },
      select: { id: true },
    });
    expect(farmVerification.updateMany).toHaveBeenCalled();
  });

  it('resets a round and returns its evidence keys', async () => {
    verificationEvidence.findMany.mockResolvedValue([
      { storageKey: 'a' },
      { storageKey: 'b' },
    ]);
    await expect(service.resetRound(client, 'round-1')).resolves.toEqual([
      'a',
      'b',
    ]);
    expect(verificationCheck.deleteMany).toHaveBeenCalledWith({
      where: { verificationId: 'round-1' },
    });
    expect(farmVerification.update).toHaveBeenCalledWith({
      where: { id: 'round-1' },
      data: expect.objectContaining({
        agentId: null,
        status: VerificationTaskStatus.UNASSIGNED,
        locationMatches: null,
        startedAt: null,
      }),
    });
  });

  it('retries every waiting round and counts the ones assigned', async () => {
    farmVerification.findMany.mockResolvedValue([
      { id: 'round-1' },
      { id: 'round-2' },
    ]);
    agent.findMany
      .mockResolvedValueOnce([candidate('a', 0)])
      .mockResolvedValueOnce([]);
    await expect(service.assignWaiting()).resolves.toBe(1);
    expect(farmVerification.findMany).toHaveBeenCalledWith({
      where: { status: VerificationTaskStatus.UNASSIGNED },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});
