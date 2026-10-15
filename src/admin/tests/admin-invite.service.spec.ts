import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail/mail.service';
import { AdminInviteService } from '../admin-invite.service';
import { AdminService } from '../admin.service';

const dto = {
  email: 'new@laicos.test',
  firstName: 'Ngozi',
  lastName: 'Adeyemi',
  phoneNumber: '+2348012345678',
};
const user = { id: 'user-2', role: Role.ADMIN, firstName: 'Ngozi' };
const profile = {
  id: 'admin-2',
  adminId: 'AD-000002',
  userId: user.id,
  createdAt: new Date('2026-10-14'),
  updatedAt: new Date('2026-10-14'),
};

describe('AdminInviteService', () => {
  const auth = {
    createFirebaseUser: jest.fn(),
    createLocalUser: jest.fn(),
    deleteFirebaseUser: jest.fn(),
  };
  const admins = { findMine: jest.fn() };
  const mail = { send: jest.fn() };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('https://app.laicos.ng'),
  };
  const service = new AdminInviteService(
    auth as unknown as AuthService,
    admins as unknown as AdminService,
    mail as unknown as MailService,
    config as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    config.getOrThrow.mockReturnValue('https://app.laicos.ng');
    auth.createFirebaseUser.mockResolvedValue({ uid: 'uid-2' });
    auth.createLocalUser.mockResolvedValue(user);
    admins.findMine.mockResolvedValue(profile);
    mail.send.mockResolvedValue(undefined);
  });

  it('creates a verified admin on a temporary password and emails it', async () => {
    await expect(service.invite(dto)).resolves.toEqual(profile);

    const [firebaseUser] = auth.createFirebaseUser.mock.calls[0] as [
      { password: string; emailVerified: boolean },
    ];
    expect(firebaseUser).toEqual({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: firebaseUser.password,
      emailVerified: true,
    });
    expect(firebaseUser.password.length).toBeGreaterThan(8);
    expect(auth.createLocalUser).toHaveBeenCalledWith({
      firebaseUid: 'uid-2',
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
      role: Role.ADMIN,
      isVerified: true,
      agreedToTerms: true,
      mustChangePassword: true,
    });
    expect(mail.send).toHaveBeenCalledWith(
      dto.email,
      expect.objectContaining({
        text: expect.stringContaining(firebaseUser.password) as string,
      }),
    );
    expect(admins.findMine).toHaveBeenCalledWith(user);
  });

  it('deletes the new Firebase user and skips the email when the write fails', async () => {
    auth.createLocalUser.mockRejectedValue(
      new ConflictException('Account already registered'),
    );

    await expect(service.invite(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-2');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('keeps the account when only the invite email fails', async () => {
    mail.send.mockRejectedValue(new Error('smtp down'));

    await expect(service.invite(dto)).resolves.toEqual(profile);
    expect(auth.deleteFirebaseUser).not.toHaveBeenCalled();
  });
});
