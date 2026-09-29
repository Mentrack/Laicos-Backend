import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckResult,
  EvidenceKind,
  FarmVerificationStatus,
  PhotoSlot,
  VerificationCheckKey,
  VerificationTaskStatus,
  type Agent,
} from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AssignmentService } from '../services/assignment.service';
import { VerificationService } from '../services/verification.service';

const agent = { id: 'agent-1', isVerified: true } as Agent;
const roundId = '1f0e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const scoped = { id: roundId, agentId: agent.id };
const openWhere = {
  ...scoped,
  status: {
    in: [VerificationTaskStatus.ASSIGNED, VerificationTaskStatus.IN_PROGRESS],
  },
};
const image: StorageUploadFile = {
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0]),
  mimetype: 'image/jpeg',
  size: 4,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: roundId,
    status: VerificationTaskStatus.IN_PROGRESS,
    farmId: 'farm-1',
    agentId: agent.id,
    locationMatches: null,
    discrepancyLat: null,
    discrepancyLng: null,
    discrepancyNote: null,
    identityNote: null,
    measuredSize: null,
    estimatedYield: null,
    estimatedYieldUnit: null,
    generalNote: null,
    rejectionReason: null,
    startedAt: new Date('2026-09-01'),
    decidedAt: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    checks: [],
    evidence: [],
    farm: {
      id: 'farm-1',
      farmCode: 'LF-000001',
      name: 'Green Acres',
      location: '12 Market Road',
      state: { id: 'state-1', name: 'FCT' },
      lga: { id: 'lga-1', stateId: 'state-1', name: 'Gwagwalada' },
      size: 5,
      unit: 'ha',
      mainProduce: 'Maize',
      isExporting: false,
      ownershipDocumentKey: 'own',
      chiefConfirmationKey: null,
      owner: {
        id: 'farmer-1',
        farmerId: 'FRM-000001',
        idType: null,
        idNumber: null,
        idDocumentKey: 'farmer-id',
        user: { firstName: 'John', lastName: 'Farmer', phoneNumber: null },
      },
    },
    ...overrides,
  };
}

describe('VerificationService', () => {
  const farmVerification = {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const verificationCheck = { upsert: jest.fn() };
  const verificationEvidence = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const assignmentDecline = { create: jest.fn() };
  const cluster = { findUniqueOrThrow: jest.fn() };
  const farm = { update: jest.fn() };
  const tx = {
    farmVerification,
    verificationCheck,
    verificationEvidence,
    assignmentDecline,
    cluster,
    farm,
  };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const storage = {
    uploadPrivateFile: jest.fn(),
    deletePrivate: jest.fn(),
    getPresignedUrl: jest.fn((key: string) =>
      Promise.resolve(`https://signed/${key}`),
    ),
    presignedUrlOrNull: jest.fn((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    ),
  };
  const assignment = { resetRound: jest.fn(), assign: jest.fn() };
  const service = new VerificationService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    assignment as unknown as AssignmentService,
  );

  // The service reads the round in three shapes: the open-check select, the
  // approval checklist, and the full detail it returns.
  let current: ReturnType<typeof detail> | null;
  beforeEach(() => {
    jest.clearAllMocks();
    current = detail();
    farmVerification.findFirst.mockImplementation(() =>
      Promise.resolve(current),
    );
    farmVerification.updateMany.mockResolvedValue({ count: 1 });
    cluster.findUniqueOrThrow.mockResolvedValue({ id: 'cluster-1' });
  });

  it('lists only the agent’s rounds', async () => {
    farmVerification.findMany.mockResolvedValue([current]);
    farmVerification.count.mockResolvedValue(1);
    const result = await service.findAll(agent, {
      status: VerificationTaskStatus.ASSIGNED,
    });
    expect(farmVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: agent.id, status: VerificationTaskStatus.ASSIGNED },
      }),
    );
    expect(result.data[0].farm.farmCode).toBe('LF-000001');
  });

  it('returns the round with presigned documents and what is outstanding', async () => {
    const result = await service.findOne(agent, roundId);
    expect(farmVerification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: scoped }),
    );
    expect(result.farm.ownershipDocumentUrl).toBe('https://signed/own');
    expect(result.farm.farmer.idDocumentUrl).toBe('https://signed/farmer-id');
    expect(result.outstanding).toContain('Location match is not recorded');
  });

  it('404s another agent’s round', async () => {
    current = null;
    await expect(service.findOne(agent, roundId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('draft saves', () => {
    it('starts an assigned round on its first save', async () => {
      current = detail({
        status: VerificationTaskStatus.ASSIGNED,
        startedAt: null,
      });
      await service.saveLocation(agent, roundId, { matches: true });
      expect(farmVerification.updateMany).toHaveBeenCalledWith({
        where: openWhere,
        data: {
          locationMatches: true,
          discrepancyLat: null,
          discrepancyLng: null,
          discrepancyNote: null,
          status: VerificationTaskStatus.IN_PROGRESS,
        },
      });
      expect(farmVerification.update).toHaveBeenCalledWith({
        where: { id: roundId },
        data: { startedAt: expect.any(Date) },
      });
    });

    it('records a discrepancy without insisting on its details yet', async () => {
      await service.saveLocation(agent, roundId, {
        matches: false,
        latitude: 8.1,
      });
      expect(farmVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locationMatches: false,
            discrepancyLat: 8.1,
            discrepancyLng: null,
          }),
        }),
      );
      expect(farmVerification.update).not.toHaveBeenCalled();
    });

    it('409s a save on a decided round', async () => {
      current = detail({ status: VerificationTaskStatus.APPROVED });
      await expect(
        service.saveLocation(agent, roundId, { matches: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when the round closes between the read and the write', async () => {
      farmVerification.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.saveLocation(agent, roundId, { matches: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('upserts a check with a result its section allows', async () => {
      await service.saveCheck(agent, roundId, VerificationCheckKey.FARMER_ID, {
        result: CheckResult.UNABLE,
      });
      expect(verificationCheck.upsert).toHaveBeenCalledWith({
        where: {
          verificationId_key: {
            verificationId: roundId,
            key: VerificationCheckKey.FARMER_ID,
          },
        },
        create: {
          verificationId: roundId,
          key: VerificationCheckKey.FARMER_ID,
          result: CheckResult.UNABLE,
          note: null,
        },
        update: { result: CheckResult.UNABLE, note: null },
      });
    });

    it('rejects a result the check’s section does not allow', async () => {
      await expect(
        service.saveCheck(agent, roundId, VerificationCheckKey.CROP_HEALTH, {
          result: CheckResult.UNABLE,
        }),
      ).rejects.toThrow(
        new BadRequestException('CROP_HEALTH does not accept UNABLE'),
      );
      expect(verificationCheck.upsert).not.toHaveBeenCalled();
    });
  });

  describe('evidence', () => {
    beforeEach(() => {
      storage.uploadPrivateFile.mockResolvedValue('new-key');
    });

    it('replaces the photo already in a slot', async () => {
      verificationEvidence.findMany.mockResolvedValue([
        { id: 'old', storageKey: 'old-key' },
      ]);
      await service.addEvidence(
        agent,
        roundId,
        { kind: EvidenceKind.PHOTO, photoSlot: PhotoSlot.ENTRANCE },
        image,
      );
      expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
        `verifications/${roundId}`,
        image,
        expect.any(Array),
      );
      expect(verificationEvidence.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old'] } },
      });
      expect(verificationEvidence.create).toHaveBeenCalledWith({
        data: {
          verificationId: roundId,
          kind: EvidenceKind.PHOTO,
          checkKey: null,
          photoSlot: PhotoSlot.ENTRANCE,
          storageKey: 'new-key',
        },
      });
      expect(storage.deletePrivate).toHaveBeenCalledWith(['old-key']);
    });

    it('rejects a malformed evidence kind before uploading', async () => {
      await expect(
        service.addEvidence(
          agent,
          roundId,
          { kind: EvidenceKind.CHECK },
          image,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('does not upload to a closed round', async () => {
      current = detail({ status: VerificationTaskStatus.REJECTED });
      await expect(
        service.addEvidence(
          agent,
          roundId,
          { kind: EvidenceKind.LOCATION_DISCREPANCY },
          image,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('deletes the upload when recording it fails', async () => {
      verificationEvidence.create.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.addEvidence(
          agent,
          roundId,
          { kind: EvidenceKind.LOCATION_DISCREPANCY },
          image,
        ),
      ).rejects.toThrow('db down');
      expect(storage.deletePrivate).toHaveBeenCalledWith(['new-key']);
    });

    it('404s evidence that is not on this round', async () => {
      verificationEvidence.findFirst.mockResolvedValue(null);
      await expect(
        service.removeEvidence(agent, roundId, 'other'),
      ).rejects.toThrow(new NotFoundException('Evidence not found'));
    });
  });

  it('declines: records why, wipes the draft and reassigns', async () => {
    assignment.resetRound.mockResolvedValue(['photo-key']);
    await service.decline(agent, roundId, { reason: 'Too far away' });
    expect(farmVerification.updateMany).toHaveBeenCalledWith({
      where: openWhere,
      data: { status: VerificationTaskStatus.UNASSIGNED, agentId: null },
    });
    expect(assignmentDecline.create).toHaveBeenCalledWith({
      data: {
        verificationId: roundId,
        agentId: agent.id,
        reason: 'Too far away',
      },
    });
    expect(assignment.resetRound).toHaveBeenCalledWith(tx, roundId);
    expect(assignment.assign).toHaveBeenCalledWith(tx, roundId);
    expect(storage.deletePrivate).toHaveBeenCalledWith(['photo-key']);
  });

  describe('approve', () => {
    it('lists every gap and changes nothing on an incomplete checklist', async () => {
      const error: unknown = await service
        .approve(agent, roundId)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: expect.arrayContaining([
          'Location match is not recorded',
          'General note is required',
        ]),
      });
      expect(farm.update).not.toHaveBeenCalled();
    });

    it('verifies the farm into the agent’s cluster', async () => {
      current = detail({
        locationMatches: true,
        identityNote: 'Matches',
        generalNote: 'Good',
        checks: Object.values(VerificationCheckKey).map((key) => ({
          key,
          result: CheckResult.VERIFIED,
          note: null,
        })),
        evidence: [
          PhotoSlot.ENTRANCE,
          PhotoSlot.FARM_AREA,
          PhotoSlot.PRODUCE,
        ].map((photoSlot) => ({
          id: photoSlot,
          kind: EvidenceKind.PHOTO,
          checkKey: null,
          photoSlot,
          storageKey: photoSlot,
          createdAt: new Date(),
        })),
      });
      await service.approve(agent, roundId);
      expect(farmVerification.updateMany).toHaveBeenCalledWith({
        where: openWhere,
        data: {
          status: VerificationTaskStatus.APPROVED,
          decidedAt: expect.any(Date),
        },
      });
      expect(cluster.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { agentId: agent.id },
        select: { id: true },
      });
      expect(farm.update).toHaveBeenCalledWith({
        where: { id: 'farm-1' },
        data: {
          verificationStatus: FarmVerificationStatus.VERIFIED,
          clusterId: 'cluster-1',
          isClustered: true,
        },
      });
    });
  });

  it('rejects without a complete checklist and unclusters the farm', async () => {
    await service.reject(agent, roundId, { reason: 'No farm at the address' });
    expect(farmVerification.updateMany).toHaveBeenCalledWith({
      where: openWhere,
      data: {
        status: VerificationTaskStatus.REJECTED,
        rejectionReason: 'No farm at the address',
        decidedAt: expect.any(Date),
      },
    });
    expect(farm.update).toHaveBeenCalledWith({
      where: { id: 'farm-1' },
      data: {
        verificationStatus: FarmVerificationStatus.REJECTED,
        clusterId: null,
        isClustered: false,
      },
    });
  });
});
