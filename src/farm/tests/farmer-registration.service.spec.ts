import { ConflictException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  Role,
} from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FarmDocumentsService } from '../../verification/services/farm-documents.service';
import { AuditService } from '../../audit/audit.service';
import { FarmService } from '../services/farm.service';
import { FarmerRegistrationService } from '../services/farmer-registration.service';

const pdf: StorageUploadFile = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  size: 8,
};
const farm = {
  name: 'Green Acres',
  stateId: 'state-1',
  lgaId: 'lga-1',
  location: '12 Market Road',
  size: 2.5,
  mainProduce: 'Maize',
};
const farmRow = {
  id: 'farm-1',
  farmCode: 'LF-000001',
  ownerId: 'farmer-1',
  name: 'Green Acres',
  country: 'NG',
  stateId: 'state-1',
  state: { id: 'state-1', name: 'FCT' },
  lgaId: 'lga-1',
  lga: { id: 'lga-1', stateId: 'state-1', name: 'Gwagwalada' },
  location: '12 Market Road',
  size: 2.5,
  unit: 'ha',
  mainProduce: 'Maize',
  isExporting: false,
  referralAgentId: 'agent-1',
  verificationStatus: FarmVerificationStatus.PENDING,
  isClustered: false,
  clusterId: null,
  ownershipDocumentKey: 'own',
  chiefConfirmationKey: null,
  verifications: [],
  createdAt: new Date('2026-10-07'),
  updatedAt: new Date('2026-10-07'),
};
const farmerRow = {
  id: 'farmer-1',
  farmerId: 'FRM-000001',
  userId: 'user-1',
  idType: 'NIN',
  idNumber: '12345678901',
  createdAt: new Date('2026-10-07'),
  updatedAt: new Date('2026-10-07'),
};

describe('FarmerRegistrationService', () => {
  const farmer = { findUniqueOrThrow: jest.fn() };
  const tx = { farmer };
  const database = {
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const storage = {
    deletePrivate: jest.fn(),
    presignedUrlOrNull: jest.fn(() => Promise.resolve(null)),
  };
  const auth = {
    createLocalUser: jest.fn(),
    deleteFirebaseUser: jest.fn(),
  };
  const farms = { insertFarm: jest.fn() };
  const documents = { uploadAll: jest.fn() };
  const locations = { requireLga: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new FarmerRegistrationService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    auth as unknown as AuthService,
    farms as unknown as FarmService,
    documents as unknown as FarmDocumentsService,
    locations as unknown as LocationService,
    audit as unknown as AuditService,
  );
  const user = { id: 'user-1', role: Role.FARMER };
  const input = {
    account: { uid: 'uid-1', isNew: true },
    user: {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      phoneNumber: '+2348012345678',
      isVerified: false,
    },
    identity: { idType: 'NIN' as const, idNumber: '12345678901' },
    farm: { ...farm, referralAgentId: 'agent-1' },
    documents: { idDocument: pdf, ownershipDocument: pdf },
    preferredAgentId: 'agent-1',
    agentUserId: 'agent-user-1',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    auth.createLocalUser.mockResolvedValue(user);
    farmer.findUniqueOrThrow.mockResolvedValue(farmerRow);
    farms.insertFarm.mockResolvedValue({
      farm: farmRow,
      verificationId: 'round-1',
    });
    storage.presignedUrlOrNull.mockResolvedValue(null);
    documents.uploadAll.mockResolvedValue({
      idDocumentKey: 'farmers/f/id/x.pdf',
      ownershipDocumentKey: 'farms/f/ownership/x.pdf',
      chiefConfirmationKey: null,
      uploaded: ['farmers/f/id/x.pdf', 'farms/f/ownership/x.pdf'],
    });
  });

  it('deletes the uploads and the new account when the write fails', async () => {
    auth.createLocalUser.mockRejectedValue(
      new ConflictException('Account already registered'),
    );
    await expect(service.register(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.deletePrivate).toHaveBeenCalled();
    expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-1');
  });

  it('keeps an account it did not create when the write fails', async () => {
    auth.createLocalUser.mockRejectedValue(new ConflictException());
    await expect(
      service.register({ ...input, account: { uid: 'uid-1', isNew: false } }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auth.deleteFirebaseUser).not.toHaveBeenCalled();
  });

  it('registers with a preferred agent for the first round', async () => {
    await service.register(input);
    expect(farms.insertFarm).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ referralAgentId: 'agent-1' }),
      'agent-1',
    );
  });

  it('writes onboarding audit when a preferred agent is set', async () => {
    await service.register(input);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorType: AuditActorType.EXTENSION_AGENT,
        actorUserId: 'agent-user-1',
        category: AuditCategory.ONBOARDING,
        resource: AuditResource.FARM,
      }),
    );
  });

  it('records every registration row as the onboarding agent', async () => {
    await service.register(input);
    expect(audit.record).toHaveBeenCalledTimes(5);
    for (const [, event] of audit.record.mock.calls as [unknown, object][]) {
      expect(event).toMatchObject({
        actorType: AuditActorType.EXTENSION_AGENT,
        actorUserId: 'agent-user-1',
      });
    }
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        title: 'Account created',
        farmerId: 'farmer-1',
        agentId: null,
      }),
    );
  });
});
