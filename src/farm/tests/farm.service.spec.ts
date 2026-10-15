import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  IdType,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AssignmentService } from '../../verification/services/assignment.service';
import { FarmDocumentsService } from '../../verification/services/farm-documents.service';
import { FarmService } from '../services/farm.service';

const user = { id: 'user-1', role: Role.FARMER } as User;
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const owned = { owner: { userId: user.id } };
const dto = {
  name: 'Green Acres',
  stateId: 'state-1',
  lgaId: 'lga-1',
  location: '12 Market Road',
  size: 5,
  mainProduce: 'Maize',
};
const pdf: StorageUploadFile = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  size: 8,
};
const row = {
  id: farmId,
  farmCode: 'LF-000001',
  ownerId: 'farmer-1',
  name: 'Green Acres',
  country: 'NG',
  stateId: 'state-1',
  state: { id: 'state-1', name: 'Oyo' },
  lgaId: 'lga-1',
  lga: { id: 'lga-1', stateId: 'state-1', name: 'Ogbomosho North' },
  location: '12 Market Road',
  size: 5,
  unit: 'ha',
  mainProduce: 'Maize',
  isExporting: false,
  referralAgentId: null,
  verificationStatus: FarmVerificationStatus.PENDING,
  isClustered: false,
  clusterId: null,
  ownershipDocumentKey: 'farms/f/ownership/a.pdf',
  chiefConfirmationKey: null,
  verifications: [],
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('FarmService', () => {
  const farm = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const farmer = { findUnique: jest.fn() };
  const farmVerification = { findFirst: jest.fn() };
  const assignmentDecline = { deleteMany: jest.fn() };
  const tx = { farm, farmer, farmVerification, assignmentDecline };
  const database = {
    ...tx,
    // Array form for batched reads; callback form runs against the same mocks.
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
  const locations = { requireLga: jest.fn() };
  const assignment = {
    openRound: jest.fn(),
    assign: jest.fn(),
    resetRound: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const service = new FarmService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    locations as unknown as LocationService,
    assignment as unknown as AssignmentService,
    new FarmDocumentsService(
      database as unknown as PrismaService,
      storage as unknown as StorageService,
      audit as unknown as AuditService,
    ),
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    farmer.findUnique.mockResolvedValue({
      id: 'farmer-1',
      idDocumentKey: 'farmers/farmer-1/id/a.pdf',
    });
    locations.requireLga.mockResolvedValue({ id: 'lga-1' });
    storage.uploadPrivateFile.mockImplementation((prefix: string) =>
      Promise.resolve(`${prefix}/x.pdf`),
    );
    farm.findUniqueOrThrow.mockResolvedValue(row);
    farm.findFirst.mockResolvedValue(row);
  });

  describe('create', () => {
    it('stores the documents under the farm and opens a verification round', async () => {
      const result = await service.create(user, dto, {
        ownershipDocument: pdf,
        chiefConfirmation: pdf,
      });
      const [[{ data }]] = farm.create.mock.calls as [
        [{ data: { id: string } & Record<string, unknown> }],
      ];
      expect(data).toMatchObject({
        ownerId: 'farmer-1',
        stateId: 'state-1',
        lgaId: 'lga-1',
        ownershipDocumentKey: `farms/${data.id}/ownership/x.pdf`,
        chiefConfirmationKey: `farms/${data.id}/chief-confirmation/x.pdf`,
      });
      expect(assignment.openRound).toHaveBeenCalledWith(tx, data.id, undefined);
      expect(result).toMatchObject({
        farmCode: 'LF-000001',
        verificationStatus: FarmVerificationStatus.PENDING,
        ownershipDocumentUrl: 'https://signed/farms/f/ownership/a.pdf',
        chiefConfirmationUrl: null,
      });
      expect(result).not.toHaveProperty('ownershipDocumentKey');
    });

    it('records the farm and an ownership document on create', async () => {
      await service.create(user, dto, { ownershipDocument: pdf });
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.FARM,
        title: 'Farm LF-000001 created',
        summary: 'Green Acres, Maize',
        actionLabel: 'View farm',
        resource: AuditResource.FARM,
        resourceId: farmId,
      });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.DOCUMENTS,
        title: 'Farm documents uploaded',
        summary: 'ownership',
        actionLabel: 'View farm',
        resource: AuditResource.FARM,
        resourceId: farmId,
      });
    });

    it('records only the farm when create sends no documents', async () => {
      farm.findUniqueOrThrow.mockResolvedValue({
        ...row,
        ownershipDocumentKey: null,
      });
      await service.create(user, dto, {});
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          title: 'Farm LF-000001 created',
          summary: 'Green Acres, Maize',
        }),
      );
    });

    it('creates a farm without any documents', async () => {
      farm.findUniqueOrThrow.mockResolvedValue({
        ...row,
        ownershipDocumentKey: null,
      });
      const result = await service.create(user, dto, {});
      const [[{ data }]] = farm.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).toMatchObject({
        ownershipDocumentKey: null,
        chiefConfirmationKey: null,
      });
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
      expect(result.ownershipDocumentUrl).toBeNull();
    });

    it('refuses a farmer without an ID document before uploading', async () => {
      farmer.findUnique.mockResolvedValue({
        id: 'farmer-1',
        idDocumentKey: null,
      });
      await expect(
        service.create(user, dto, { ownershipDocument: pdf }),
      ).rejects.toThrow(
        new BadRequestException(
          'Upload your ID document before creating a farm',
        ),
      );
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('checks the LGA belongs to the state before uploading', async () => {
      locations.requireLga.mockRejectedValue(
        new BadRequestException('Invalid state or LGA'),
      );
      await expect(
        service.create(user, dto, { ownershipDocument: pdf }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('deletes the uploads when the write fails, mapping a bad referral to 400', async () => {
      farm.create.mockRejectedValue(prismaError('P2003'));
      await expect(
        service.create(
          user,
          { ...dto, referralAgentId: 'nope' },
          { ownershipDocument: pdf },
        ),
      ).rejects.toThrow(new BadRequestException('Referral agent not found'));
      const [[keys]] = storage.deletePrivate.mock.calls as [[string[]]];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/\/ownership\/x\.pdf$/);
    });

    it('404s a user without a farmer profile', async () => {
      farmer.findUnique.mockResolvedValue(null);
      await expect(
        service.create(user, dto, { ownershipDocument: pdf }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('paginates only the user’s farms', async () => {
    farm.findMany.mockResolvedValue([row]);
    farm.count.mockResolvedValue(45);
    const result = await service.findAll(user, { page: 2, perPage: 20 });
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: owned, skip: 20, take: 20 }),
    );
    expect(farm.count).toHaveBeenCalledWith({ where: owned });
    expect(result.data[0].farmCode).toBe('LF-000001');
    expect(result.metaData).toEqual({
      page: 2,
      perPage: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('shows the rejection reason only while the farm is rejected', async () => {
    farm.findFirst.mockResolvedValue({
      ...row,
      verificationStatus: FarmVerificationStatus.REJECTED,
      verifications: [{ rejectionReason: 'No farm at the address' }],
    });
    await expect(service.findOne(user, farmId)).resolves.toMatchObject({
      rejectionReason: 'No farm at the address',
    });
  });

  it('404s on a farm the user does not own', async () => {
    farm.findFirst.mockResolvedValue(null);
    await expect(service.findOne(user, farmId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(farm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: farmId, ...owned } }),
    );
  });

  it('lets a cluster agent read a farm they manage', async () => {
    const agent = { id: 'agent-user', role: Role.EXTENSION_AGENT } as User;
    await expect(service.findOne(agent, farmId)).resolves.toMatchObject({
      farmCode: 'LF-000001',
    });
    expect(farm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: farmId,
          cluster: { agent: { userId: agent.id } },
        },
      }),
    );
  });

  describe('update', () => {
    function current(status: FarmVerificationStatus) {
      farm.findFirst.mockResolvedValueOnce({
        stateId: 'state-1',
        lgaId: 'lga-1',
        location: '12 Market Road',
        verificationStatus: status,
        farmCode: 'LF-000001',
        name: 'Green Acres',
        ownerId: 'farmer-1',
      });
    }

    it('records a farm update in the transaction', async () => {
      current(FarmVerificationStatus.PENDING);
      await service.update(user, farmId, { name: 'New name' });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.FARM,
        title: 'Farm LF-000001 updated',
        summary: 'New name',
        actionLabel: 'View farm',
        resource: AuditResource.FARM,
        resourceId: farmId,
      });
    });

    it('resubmits a rejected farm to the agent who rejected it', async () => {
      current(FarmVerificationStatus.REJECTED);
      farmVerification.findFirst.mockResolvedValue({ agentId: 'agent-1' });
      await service.update(user, farmId, { size: 4 });
      expect(farm.update).toHaveBeenCalledWith({
        where: { id: farmId, ...owned },
        data: expect.objectContaining({
          size: 4,
          verificationStatus: FarmVerificationStatus.PENDING,
          clusterId: null,
          isClustered: false,
        }),
      });
      expect(assignment.openRound).toHaveBeenCalledWith(tx, farmId, 'agent-1');
    });

    it('keeps a verified farm verified through a non-location edit', async () => {
      current(FarmVerificationStatus.VERIFIED);
      await service.update(user, farmId, { name: 'New name' });
      const [[{ data }]] = farm.update.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).not.toHaveProperty('verificationStatus');
      expect(assignment.openRound).not.toHaveBeenCalled();
    });

    it('sends a verified farm that moved LGA back through verification there', async () => {
      current(FarmVerificationStatus.VERIFIED);
      farmVerification.findFirst.mockResolvedValue({ agentId: 'agent-1' });
      await service.update(user, farmId, { lgaId: 'lga-2' });
      expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-2');
      expect(farm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lgaId: 'lga-2',
            verificationStatus: FarmVerificationStatus.PENDING,
            isClustered: false,
          }),
        }),
      );
      expect(assignment.openRound).toHaveBeenCalledWith(tx, farmId, null);
    });

    it('reopens a verified farm whose address changed, with the same agent', async () => {
      current(FarmVerificationStatus.VERIFIED);
      farmVerification.findFirst.mockResolvedValue({ agentId: 'agent-1' });
      await service.update(user, farmId, { location: '1 New Road' });
      expect(assignment.openRound).toHaveBeenCalledWith(tx, farmId, 'agent-1');
    });

    it('hands a pending farm’s open round to its new LGA', async () => {
      current(FarmVerificationStatus.PENDING);
      farmVerification.findFirst.mockResolvedValue({ id: 'round-1' });
      assignment.resetRound.mockResolvedValue(['evidence-key']);
      await service.update(user, farmId, { lgaId: 'lga-2' });
      expect(assignmentDecline.deleteMany).toHaveBeenCalledWith({
        where: { verificationId: 'round-1' },
      });
      expect(assignment.resetRound).toHaveBeenCalledWith(tx, 'round-1');
      expect(assignment.assign).toHaveBeenCalledWith(tx, 'round-1');
      expect(assignment.openRound).not.toHaveBeenCalled();
      expect(storage.deletePrivate).toHaveBeenCalledWith(['evidence-key']);
    });

    it('leaves a pending farm’s round alone for other edits', async () => {
      current(FarmVerificationStatus.PENDING);
      await service.update(user, farmId, { name: 'New name' });
      expect(assignment.resetRound).not.toHaveBeenCalled();
      expect(assignment.openRound).not.toHaveBeenCalled();
    });

    it('404s a farm the user does not own', async () => {
      farm.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.update(user, farmId, { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(farm.update).not.toHaveBeenCalled();
    });
  });

  it('opens the inserted farm’s round with the preferred agent', async () => {
    farm.create.mockResolvedValue(undefined);
    assignment.openRound.mockResolvedValue('round-1');
    const result = await service.insertFarm(
      tx as unknown as Prisma.TransactionClient,
      { ...dto, ownerId: 'farmer-1' },
      'agent-1',
    );
    const [[{ data }]] = farm.create.mock.calls as [[{ data: { id: string } }]];
    expect(assignment.openRound).toHaveBeenCalledWith(tx, data.id, 'agent-1');
    expect(result).toEqual({ farm: row, verificationId: 'round-1' });
  });

  it('replaces documents only on a farm the user owns', async () => {
    const replace = jest
      .spyOn(FarmDocumentsService.prototype, 'replace')
      .mockResolvedValue(undefined);
    await service.replaceDocuments(user, farmId, { ownershipDocument: pdf });
    expect(replace).toHaveBeenCalledWith(
      farmId,
      owned,
      { ownershipDocument: pdf },
      [
        expect.objectContaining({
          actorType: AuditActorType.FARMER,
          farmerId: 'farmer-1',
          farmId,
          title: 'Farm documents uploaded',
          summary: 'ownership',
        }),
      ],
    );
    replace.mockRestore();
  });

  it('passes one combined farm-document row when both farm files are sent', async () => {
    const replace = jest
      .spyOn(FarmDocumentsService.prototype, 'replace')
      .mockResolvedValue(undefined);
    await service.replaceDocuments(user, farmId, {
      ownershipDocument: pdf,
      chiefConfirmation: pdf,
    });
    const events = replace.mock.calls[0][3] as unknown[];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        title: 'Farm documents uploaded',
        summary: 'ownership and chief confirmation',
        farmId,
      }),
    );
    replace.mockRestore();
  });

  it('passes a farmer ID event when only the ID document is replaced', async () => {
    farmer.findUnique.mockResolvedValue({
      id: 'farmer-1',
      idType: IdType.NIN,
      idDocumentKey: 'farmers/farmer-1/id/a.pdf',
    });
    const replace = jest
      .spyOn(FarmDocumentsService.prototype, 'replace')
      .mockResolvedValue(undefined);
    await service.replaceDocuments(user, farmId, { idDocument: pdf });
    expect(replace).toHaveBeenCalledWith(farmId, owned, { idDocument: pdf }, [
      expect.objectContaining({
        farmId: null,
        title: 'ID document uploaded',
        summary: 'NIN',
      }),
    ]);
    replace.mockRestore();
  });

  describe('remove', () => {
    beforeEach(() => {
      farm.findUniqueOrThrow.mockResolvedValue({
        ownershipDocumentKey: 'own',
        chiefConfirmationKey: null,
        verifications: [{ evidence: [{ storageKey: 'photo' }] }],
      });
    });

    it('deletes the farm, then its stored documents and evidence', async () => {
      await service.remove(user, farmId);
      expect(farm.delete).toHaveBeenCalledWith({
        where: { id: farmId, ...owned },
      });
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'own',
        null,
        'photo',
      ]);
    });

    it('maps a delete blocked by orders to 409 and keeps the files', async () => {
      farm.delete.mockRejectedValue(prismaError('P2003'));
      await expect(service.remove(user, farmId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.deletePrivate).not.toHaveBeenCalled();
    });

    it('rethrows unknown errors untouched', async () => {
      const error = new Error('db down');
      farm.delete.mockRejectedValue(error);
      await expect(service.remove(user, farmId)).rejects.toBe(error);
    });
  });
});
