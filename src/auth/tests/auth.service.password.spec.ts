import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
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
  );
  const dto = { currentPassword: 'Temp-pass', newPassword: 'NewPassword1!' };

  beforeEach(() => jest.clearAllMocks());

  it('clears a temporary password’s flag', async () => {
    const onboarded = {
      id: 'user-1',
      firebaseUid: 'uid-1',
      email: 'ada@example.com',
      mustChangePassword: true,
    } as User;
    await service.changePassword(onboarded, dto);
    expect(firebase.auth.updateUser).toHaveBeenCalledWith('uid-1', {
      password: 'NewPassword1!',
    });
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { mustChangePassword: false },
    });
  });

  it('leaves a permanent password’s user row alone', async () => {
    const regular = {
      id: 'user-1',
      firebaseUid: 'uid-1',
      email: 'ada@example.com',
      mustChangePassword: false,
    } as User;
    await service.changePassword(regular, dto);
    expect(user.update).not.toHaveBeenCalled();
  });
});
