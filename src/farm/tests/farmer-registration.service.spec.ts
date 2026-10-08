import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  Role,
} from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { FirebaseService } from '../../auth/firebase/firebase.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FarmDocumentsService } from '../../verification/services/farm-documents.service';
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
const signup = {
  ...farm,
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  phoneNumber: '+2348012345678',
  agreedToTerms: true,
  idType: 'NIN' as const,
  idNumber: '12345678901',
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
  referralAgentId: null,
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
  idDocumentKey: 'id',
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
    createFirebaseUser: jest.fn(),
    createLocalUser: jest.fn(),
    deleteFirebaseUser: jest.fn(),
  };
  const firebase = { signInWithGoogle: jest.fn() };
  const farms = { insertFarm: jest.fn() };
  const documents = { uploadAll: jest.fn() };
  const locations = { requireLga: jest.fn() };
  const service = new FarmerRegistrationService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    auth as unknown as AuthService,
    firebase as unknown as FirebaseService,
    farms as unknown as FarmService,
    documents as unknown as FarmDocumentsService,
    locations as unknown as LocationService,
  );
  const user = { id: 'user-1', role: Role.FARMER };

  beforeEach(() => {
    jest.resetAllMocks();
    auth.createFirebaseUser.mockResolvedValue({ uid: 'uid-1' });
    auth.createLocalUser.mockResolvedValue(user);
    farmer.findUniqueOrThrow.mockResolvedValue(farmerRow);
    farms.insertFarm.mockResolvedValue(farmRow);
    storage.presignedUrlOrNull.mockResolvedValue(null);
    documents.uploadAll.mockResolvedValue({
      idDocumentKey: 'farmers/f/id/x.pdf',
      ownershipDocumentKey: 'farms/f/ownership/x.pdf',
      chiefConfirmationKey: null,
      uploaded: ['farmers/f/id/x.pdf', 'farms/f/ownership/x.pdf'],
    });
  });

  describe('signUp', () => {
    it('creates a password-less account, the farmer with their ID, and the farm', async () => {
      const result = await service.signUp(signup, {
        idDocument: pdf,
        ownershipDocument: pdf,
      });

      expect(auth.createFirebaseUser).toHaveBeenCalledWith({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
      });
      const [[farmerId, farmId]] = documents.uploadAll.mock.calls as [
        [string, string],
      ];
      expect(auth.createLocalUser).toHaveBeenCalledWith(
        {
          firebaseUid: 'uid-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Okafor',
          phoneNumber: '+2348012345678',
          agreedToTerms: true,
          isVerified: false,
          role: Role.FARMER,
          farmer: {
            id: farmerId,
            idType: 'NIN',
            idNumber: '12345678901',
            idDocumentKey: 'farmers/f/id/x.pdf',
          },
        },
        tx,
      );
      expect(farms.insertFarm).toHaveBeenCalledWith(
        tx,
        {
          ...farm,
          unit: undefined,
          isExporting: undefined,
          referralAgentId: undefined,
          id: farmId,
          ownerId: farmerId,
          ownershipDocumentKey: 'farms/f/ownership/x.pdf',
          chiefConfirmationKey: null,
        },
        undefined,
      );
      expect(result).toMatchObject({
        user,
        farmer: { farmerId: 'FRM-000001' },
        farm: { farmCode: 'LF-000001' },
      });
      expect(result.farmer).not.toHaveProperty('idNumber');
    });

    it('checks the LGA, then deletes the new account it already made', async () => {
      locations.requireLga.mockRejectedValue(
        new BadRequestException('Invalid state or LGA'),
      );
      await expect(service.signUp(signup, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(documents.uploadAll).not.toHaveBeenCalled();
      expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-1');
    });

    it('deletes the uploads and the account when the write fails', async () => {
      auth.createLocalUser.mockRejectedValue(
        new ConflictException('Account already registered'),
      );
      await expect(
        service.signUp(signup, { idDocument: pdf }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'farmers/f/id/x.pdf',
        'farms/f/ownership/x.pdf',
      ]);
      expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-1');
    });

    it('maps a bad referral agent to 400', async () => {
      farms.insertFarm.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );
      await expect(service.signUp(signup, {})).rejects.toThrow(
        new BadRequestException('Referral agent not found'),
      );
    });
  });

  describe('signUpWithGoogle', () => {
    const {
      email: _email,
      firstName: _first,
      lastName: _last,
      ...rest
    } = signup;
    const dto = { ...rest, idToken: 'google-token' };

    beforeEach(() => {
      firebase.signInWithGoogle.mockResolvedValue({
        localId: 'google-uid',
        email: 'ada@gmail.com',
        emailVerified: true,
        firstName: 'Ada',
        lastName: 'Okafor',
        isNewUser: true,
      });
    });

    it('takes the name and email from Google', async () => {
      await service.signUpWithGoogle(dto, {});
      expect(auth.createFirebaseUser).not.toHaveBeenCalled();
      expect(auth.createLocalUser).toHaveBeenCalledWith(
        expect.objectContaining({
          firebaseUid: 'google-uid',
          email: 'ada@gmail.com',
          isVerified: true,
        }),
        tx,
      );
    });

    it('keeps a Google account it did not create when the write fails', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        localId: 'google-uid',
        email: 'ada@gmail.com',
        emailVerified: true,
        firstName: 'Ada',
        lastName: 'Okafor',
        isNewUser: false,
      });
      auth.createLocalUser.mockRejectedValue(
        new ConflictException('Account already registered'),
      );
      await expect(service.signUpWithGoogle(dto, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(auth.deleteFirebaseUser).not.toHaveBeenCalled();
    });
  });

  it('registers with a preferred agent for the first round', async () => {
    await service.register({
      account: { uid: 'uid-1', isNew: true },
      user: {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        phoneNumber: '+2348012345678',
        isVerified: false,
      },
      farm: { ...farm, referralAgentId: 'agent-1' },
      documents: {},
      preferredAgentId: 'agent-1',
    });
    expect(farms.insertFarm).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ referralAgentId: 'agent-1' }),
      'agent-1',
    );
  });
});
