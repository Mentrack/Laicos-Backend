import { ConfigService } from '@nestjs/config';
import { Prisma, Role, type User } from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

describe('AuthService.createDraftApplication', () => {
  const application = { create: jest.fn() };
  const tx = { application } as unknown as Prisma.TransactionClient;
  const service = new AuthService(
    {} as PrismaService,
    {} as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    {} as StorageService,
    {} as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    application.create.mockResolvedValue({ id: 'app-1' });
  });

  it.each([Role.FARMER, Role.EXTENSION_AGENT])(
    'creates a draft application for %s',
    async (role) => {
      await service.createDraftApplication(tx, { id: 'user-1', role } as User);

      expect(application.create).toHaveBeenCalledWith({
        data: { userId: 'user-1' },
      });
    },
  );

  it.each([Role.ADMIN, Role.BUYER])('creates nothing for %s', async (role) => {
    await service.createDraftApplication(tx, { id: 'user-1', role } as User);

    expect(application.create).not.toHaveBeenCalled();
  });
});
