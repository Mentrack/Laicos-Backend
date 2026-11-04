import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(),
  getApps: () => [],
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

describe('AuthService logout', () => {
  const refreshToken = { deleteMany: jest.fn() };
  const pushDevice = { deleteMany: jest.fn() };
  const firebase = { auth: { revokeRefreshTokens: jest.fn() } };
  const service = new AuthService(
    { refreshToken, pushDevice } as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    {} as StorageService,
    { record: jest.fn() } as unknown as AuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('revokes sessions and clears the user push devices', async () => {
    await service.logout({ id: 'user-1', firebaseUid: 'uid-1' } as User);
    expect(firebase.auth.revokeRefreshTokens).toHaveBeenCalledWith('uid-1');
    expect(refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});
