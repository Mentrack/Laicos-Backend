import { NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  IdType,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FarmerService } from '../services/farmer.service';

const user = { id: 'user-1', role: Role.FARMER } as User;
const row = {
  id: 'farmer-1',
  farmerId: 'FRM-000001',
  userId: user.id,
  idType: IdType.NIN,
  idNumber: '12345678901',
  idDocumentKey: 'farmers/farmer-1/id/old.pdf',
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};
const pdf: StorageUploadFile = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  size: 8,
};

describe('FarmerService', () => {
  const farmer = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const farm = { findMany: jest.fn().mockResolvedValue([]) };
  const audit = { record: jest.fn() };
  const tx = { farmer };
  const database = {
    farmer,
    farm,
    farmVerification: { update: jest.fn() },
    $transaction: jest.fn(
      (arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>)) => {
        if (typeof arg === 'function') {
          return arg(tx);
        }
        return Promise.all(arg);
      },
    ),
  };
  const storage = {
    presignedUrlOrNull: jest.fn((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    ),
    uploadPrivateFile: jest.fn(),
    deletePrivate: jest.fn(),
  };
  const service = new FarmerService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the current user’s profile with a presigned ID URL', async () => {
    farmer.findUnique.mockResolvedValue(row);
    await expect(service.findMine(user)).resolves.toEqual({
      id: row.id,
      farmerId: row.farmerId,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      idType: IdType.NIN,
      idNumber: '12345678901',
      idDocumentUrl: 'https://signed/farmers/farmer-1/id/old.pdf',
    });
    expect(farmer.findUnique).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
  });

  it('never exposes another farmer’s ID', async () => {
    farmer.findUnique.mockResolvedValue(row);
    const result = await service.findOne(row.id);
    expect(result).not.toHaveProperty('idNumber');
    expect(result).not.toHaveProperty('idDocumentKey');
  });

  it('replaces the ID document and removes the old object', async () => {
    farmer.findUnique.mockResolvedValue(row);
    storage.uploadPrivateFile.mockResolvedValue('farmers/farmer-1/id/new.pdf');
    await service.uploadIdDocument(user, pdf);
    expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
      'farmers/farmer-1/id',
      pdf,
      expect.any(Array),
    );
    expect(farmer.update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { idDocumentKey: 'farmers/farmer-1/id/new.pdf' },
    });
    expect(storage.deletePrivate).toHaveBeenCalledWith([row.idDocumentKey]);
  });

  it('removes the new upload when saving its key fails', async () => {
    farmer.findUnique.mockResolvedValue(row);
    storage.uploadPrivateFile.mockResolvedValue('farmers/farmer-1/id/new.pdf');
    farmer.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.uploadIdDocument(user, pdf)).rejects.toThrow(
      'db down',
    );
    expect(storage.deletePrivate).toHaveBeenCalledWith([
      'farmers/farmer-1/id/new.pdf',
    ]);
    expect(storage.deletePrivate).not.toHaveBeenCalledWith([row.idDocumentKey]);
  });

  it('404s when the farmer does not exist', async () => {
    farmer.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('records ID details when identity fields change', async () => {
    farmer.findUnique.mockResolvedValue(row);
    farmer.update.mockResolvedValue(row);
    await service.updateMine(user, { idType: IdType.NIN, idNumber: '99' });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorType: AuditActorType.FARMER,
      farmerId: row.id,
      agentId: null,
      farmId: null,
      category: AuditCategory.PROFILE,
      title: 'Profile updated',
      summary: 'ID details',
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: row.id,
    });
  });

  it('records an ID upload with the document type', async () => {
    farmer.findUnique.mockResolvedValue(row);
    storage.uploadPrivateFile.mockResolvedValue('farmers/farmer-1/id/new.pdf');
    await service.uploadIdDocument(user, pdf);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorType: AuditActorType.FARMER,
      farmerId: row.id,
      agentId: null,
      farmId: null,
      category: AuditCategory.DOCUMENTS,
      title: 'ID document uploaded',
      summary: 'NIN',
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: row.id,
    });
  });

  it('returns a page with metaData', async () => {
    farmer.findMany.mockResolvedValue([]);
    farmer.count.mockResolvedValue(0);
    const result = await service.findAll({ page: 1, perPage: 20 });
    expect(result).toEqual({
      data: [],
      metaData: { page: 1, perPage: 20, total: 0, totalPages: 0 },
    });
  });
});
