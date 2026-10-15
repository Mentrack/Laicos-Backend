import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

const input = {
  firebaseUid: 'uid-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  isVerified: true,
  agreedToTerms: true,
};

describe('AuthService.createLocalUser', () => {
  const user = { create: jest.fn() };
  const service = new AuthService(
    { user } as unknown as PrismaService,
    {} as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    {} as StorageService,
    { record: jest.fn() } as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    user.create.mockResolvedValue({ id: 'user-1' });
  });

  it('creates an admin profile with the user', async () => {
    await service.createLocalUser({
      ...input,
      role: Role.ADMIN,
      mustChangePassword: true,
    });

    expect(user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: Role.ADMIN,
        mustChangePassword: true,
        admin: { create: {} },
        farmer: undefined,
        agent: undefined,
        buyer: undefined,
      }) as unknown,
    });
  });

  it('does not create an admin profile for a buyer', async () => {
    await service.createLocalUser({ ...input, role: Role.BUYER });

    expect(user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: Role.BUYER,
        admin: undefined,
        buyer: { create: {} },
      }) as unknown,
    });
  });
});
