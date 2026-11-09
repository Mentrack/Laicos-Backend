import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

describe('AuthService password change', () => {
  const user = { update: jest.fn() };
  const refreshToken = { deleteMany: jest.fn() };
  const database = { user, refreshToken };
  const firebase = {
    signInWithPassword: jest.fn(),
    auth: { updateUser: jest.fn(), revokeRefreshTokens: jest.fn() },
  };
  const service = new AuthService(
    database as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    {} as StorageService,
    { record: jest.fn() } as unknown as AuditService,
  );
  const dto = { currentPassword: 'Old-pass1!', newPassword: 'NewPassword1!' };

  beforeEach(() => jest.clearAllMocks());

  it('does not touch the local user', async () => {
    const regular = {
      id: 'user-1',
      firebaseUid: 'uid-1',
      email: 'ada@example.com',
    } as User;
    await service.changePassword(regular, dto);
    expect(firebase.auth.updateUser).toHaveBeenCalledWith('uid-1', {
      password: 'NewPassword1!',
    });
    expect(user.update).not.toHaveBeenCalled();
  });
});
