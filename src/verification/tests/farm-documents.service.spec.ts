import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FarmVerificationStatus, Prisma } from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FarmDocumentsService } from '../services/farm-documents.service';

const farmId = 'farm-1';
const scope = { owner: { userId: 'user-1' } };
const pdf: StorageUploadFile = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  size: 8,
};

function stored(overrides: Record<string, unknown> = {}) {
  return {
    verificationStatus: FarmVerificationStatus.PENDING,
    ownershipDocumentKey: 'old-own',
    chiefConfirmationKey: 'old-chief',
    owner: { id: 'farmer-1', idDocumentKey: 'old-id' },
    ...overrides,
  };
}

describe('FarmDocumentsService', () => {
  const farm = { findFirst: jest.fn(), update: jest.fn() };
  const farmer = { update: jest.fn() };
  const tx = { farm, farmer };
  const database = {
    ...tx,
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const storage = { uploadPrivateFile: jest.fn(), deletePrivate: jest.fn() };
  const service = new FarmDocumentsService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  const notVerified = {
    id: farmId,
    verificationStatus: { not: FarmVerificationStatus.VERIFIED },
    AND: [scope],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    farm.findFirst.mockResolvedValue(stored());
    storage.uploadPrivateFile.mockImplementation((prefix: string) =>
      Promise.resolve(`${prefix}/x.pdf`),
    );
  });

  describe('uploadAll', () => {
    it('stores each file under its owner and reports what it uploaded', async () => {
      const result = await service.uploadAll('farmer-1', farmId, {
        idDocument: pdf,
        ownershipDocument: pdf,
      });
      expect(result).toEqual({
        idDocumentKey: 'farmers/farmer-1/id/x.pdf',
        ownershipDocumentKey: 'farms/farm-1/ownership/x.pdf',
        chiefConfirmationKey: null,
        uploaded: ['farmers/farmer-1/id/x.pdf', 'farms/farm-1/ownership/x.pdf'],
      });
    });

    it('removes its own uploads when a later one fails', async () => {
      storage.uploadPrivateFile
        .mockResolvedValueOnce('farmers/farmer-1/id/x.pdf')
        .mockRejectedValueOnce(new Error('bucket down'));
      await expect(
        service.uploadAll('farmer-1', farmId, {
          idDocument: pdf,
          ownershipDocument: pdf,
        }),
      ).rejects.toThrow('bucket down');
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'farmers/farmer-1/id/x.pdf',
      ]);
    });
  });

  describe('replace', () => {
    it('stores the new farm file, then deletes only the one it replaced', async () => {
      await service.replace(farmId, scope, { ownershipDocument: pdf });
      expect(farm.update).toHaveBeenCalledWith({
        where: notVerified,
        data: { ownershipDocumentKey: 'farms/farm-1/ownership/x.pdf' },
      });
      expect(farmer.update).not.toHaveBeenCalled();
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        null,
        'old-own',
        null,
      ]);
    });

    it('replaces the farmer’s ID document on the farm’s owner', async () => {
      await service.replace(farmId, scope, { idDocument: pdf });
      expect(farmer.update).toHaveBeenCalledWith({
        where: { id: 'farmer-1' },
        data: { idDocumentKey: 'farmers/farmer-1/id/x.pdf' },
      });
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'old-id',
        null,
        null,
      ]);
    });

    it('needs at least one file', async () => {
      await expect(service.replace(farmId, scope, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(farm.findFirst).not.toHaveBeenCalled();
    });

    it('404s a farm outside the scope', async () => {
      farm.findFirst.mockResolvedValue(null);
      await expect(
        service.replace(farmId, scope, { ownershipDocument: pdf }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('refuses a verified farm before uploading', async () => {
      farm.findFirst.mockResolvedValue(
        stored({ verificationStatus: FarmVerificationStatus.VERIFIED }),
      );
      await expect(
        service.replace(farmId, scope, { ownershipDocument: pdf }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('409s and drops the upload when the farm is verified mid-request', async () => {
      farm.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.replace(farmId, scope, { chiefConfirmation: pdf }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'farms/farm-1/chief-confirmation/x.pdf',
      ]);
    });
  });
});
