import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ApplicationStatus,
  Role,
  type Application,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { FarmService } from '../../farm/services/farm.service';
import { LocationService } from '../../location/location.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ApplicationService } from '../application.service';

const user = {
  id: 'user-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  role: Role.FARMER,
} as User;

function draft(over: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    userId: 'user-1',
    status: ApplicationStatus.DRAFT,
    phoneNumber: null,
    agreedToTerms: false,
    idType: null,
    idNumber: null,
    idDocumentKey: null,
    farmName: null,
    stateId: null,
    lgaId: null,
    location: null,
    size: null,
    unit: null,
    mainProduce: null,
    isExporting: null,
    referralAgentId: null,
    ownershipDocumentKey: null,
    chiefConfirmationKey: null,
    organisation: null,
    professionalCertificateKey: null,
    bankStatementKey: null,
    completedAt: null,
    createdAt: new Date('2026-11-02'),
    updatedAt: new Date('2026-11-02'),
    ...over,
  };
}

describe('ApplicationService', () => {
  const application = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const database = {
    application,
    user: { update: jest.fn() },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(database),
  };
  const storage = {
    uploadPrivateFile: jest.fn(),
    deletePrivate: jest.fn(),
    presignedUrlOrNull: jest.fn(() => Promise.resolve(null)),
  };
  const farms = { insertFarm: jest.fn() };
  const mail = { send: jest.fn() };
  const locations = { requireLga: jest.fn() };
  const service = new ApplicationService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    locations as unknown as LocationService,
    farms as unknown as FarmService,
    { record: jest.fn() } as unknown as AuditService,
    mail as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    storage.presignedUrlOrNull.mockResolvedValue(null);
    mail.send.mockResolvedValue(undefined);
  });

  it('refuses to save a completed application', async () => {
    application.findUnique.mockResolvedValue(
      draft({ status: ApplicationStatus.COMPLETED }),
    );
    await expect(service.save(user, {}, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(application.update).not.toHaveBeenCalled();
  });

  it('leaves a draft in place when required data is missing', async () => {
    const row = draft({ phoneNumber: '+2348012345678' });
    application.findUnique.mockResolvedValue(row);
    application.update.mockResolvedValue(row);
    await expect(service.complete(user, {}, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(farms.insertFarm).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('completes a farmer application and emails that it is pending review', async () => {
    const row = draft({
      phoneNumber: '+2348012345678',
      agreedToTerms: true,
      idType: 'NIN',
      idNumber: '123',
      idDocumentKey: 'id',
      farmName: 'Green Acres',
      stateId: 'state-1',
      lgaId: 'lga-1',
      location: '12 Market Road',
      size: 2,
      mainProduce: 'Maize',
      ownershipDocumentKey: 'own',
    });
    application.findUnique.mockResolvedValue(row);
    application.update.mockResolvedValue(row);
    application.updateMany.mockResolvedValue({ count: 1 });
    application.findUniqueOrThrow.mockResolvedValue({
      ...row,
      status: ApplicationStatus.COMPLETED,
    });
    database.$transaction = (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        ...database,
        farmer: {
          create: jest.fn().mockResolvedValue({
            id: 'farmer-1',
            farmerId: 'FRM-000001',
          }),
        },
        user: { update: jest.fn() },
      });
    farms.insertFarm.mockResolvedValue({
      farm: {
        id: 'farm-1',
        farmCode: 'LF-000001',
        name: 'Green Acres',
        mainProduce: 'Maize',
      },
      verificationId: 'round-1',
    });
    locations.requireLga.mockResolvedValue({ name: 'Gwagwalada' });

    const result = await service.complete(user, {}, {});

    expect(result.status).toBe(ApplicationStatus.COMPLETED);
    expect(farms.insertFarm).toHaveBeenCalled();
    expect(mail.send).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ subject: 'Your form is pending review' }),
    );
  });

  it('stores the organisation and the two agent documents, replacing old files', async () => {
    const row = draft({
      professionalCertificateKey: 'old-cert',
      bankStatementKey: 'old-bank',
    });
    application.findUnique.mockResolvedValue(row);
    application.update.mockImplementation(
      ({ data }: { data: Partial<Application> }) =>
        Promise.resolve({ ...row, ...data }),
    );
    storage.uploadPrivateFile.mockImplementation((prefix: string) =>
      Promise.resolve(`${prefix}/file.pdf`),
    );
    storage.presignedUrlOrNull.mockImplementation((key: string | null) =>
      Promise.resolve(key && `https://signed/${key}`),
    );
    const file = {
      buffer: Buffer.from('%PDF'),
      mimetype: 'application/pdf',
      originalname: 'file.pdf',
      size: 4,
    };

    const result = await service.save(
      { ...user, role: Role.EXTENSION_AGENT },
      { organisation: 'Kano State Extension Office' },
      { professionalCertificate: file, bankStatement: file },
    );

    expect(application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: expect.objectContaining({
        organisation: 'Kano State Extension Office',
        professionalCertificateKey:
          'applications/app-1/professional-certificate/file.pdf',
        bankStatementKey: 'applications/app-1/bank-statement/file.pdf',
      }),
    });
    expect(storage.deletePrivate).toHaveBeenCalledWith(
      expect.arrayContaining(['old-cert', 'old-bank']),
    );
    expect(result).toEqual(
      expect.objectContaining({
        organisation: 'Kano State Extension Office',
        professionalCertificateUrl:
          'https://signed/applications/app-1/professional-certificate/file.pdf',
        bankStatementUrl:
          'https://signed/applications/app-1/bank-statement/file.pdf',
      }),
    );
  });

  it('copies the organisation and agent documents onto the new agent', async () => {
    const agentUser = { ...user, role: Role.EXTENSION_AGENT };
    const row = draft({
      phoneNumber: '+2348012345678',
      agreedToTerms: true,
      idType: 'NIN',
      idNumber: '123',
      idDocumentKey: 'id',
      stateId: 'state-1',
      lgaId: 'lga-1',
      organisation: 'Kano State Extension Office',
      professionalCertificateKey: 'cert',
      bankStatementKey: 'bank',
    });
    application.findUnique.mockResolvedValue(row);
    application.update.mockResolvedValue(row);
    application.updateMany.mockResolvedValue({ count: 1 });
    application.findUniqueOrThrow.mockResolvedValue({
      ...row,
      status: ApplicationStatus.COMPLETED,
    });
    const agentCreate = jest
      .fn()
      .mockResolvedValue({ id: 'agent-1', agentId: 'AG-000001' });
    database.$transaction = (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        ...database,
        agent: { create: agentCreate },
        user: { update: jest.fn() },
      });
    locations.requireLga.mockResolvedValue({ name: 'Nassarawa' });

    await service.complete(agentUser, {}, {});

    expect(agentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organisation: 'Kano State Extension Office',
        professionalCertificateKey: 'cert',
        bankStatementKey: 'bank',
      }),
    });
  });
});
