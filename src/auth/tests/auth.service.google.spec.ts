import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { FirebaseGoogleSignInDto } from '../dto';
import { FirebaseService } from '../firebase/firebase.service';

const google: FirebaseGoogleSignInDto = {
  idToken: 'firebase-id-token',
  refreshToken: 'firebase-refresh-token',
  localId: 'firebase-uid',
  expiresIn: '3600',
  email: 'ada@example.com',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Okafor',
  isNewUser: true,
};
const tokens = {
  accessToken: 'firebase-id-token',
  refreshToken: 'firebase-refresh-token',
  expiresIn: '3600',
};

describe('AuthService Google sign-in', () => {
  const user = { findUnique: jest.fn(), create: jest.fn() };
  const refreshToken = { upsert: jest.fn() };
  const database = { user, refreshToken };
  const firebase = {
    signInWithGoogle: jest.fn(),
    auth: { deleteUser: jest.fn() },
  };
  const service = new AuthService(
    database as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    {} as ConfigService,
    {} as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    firebase.auth.deleteUser.mockResolvedValue(undefined);
  });

  describe('googleLogin', () => {
    it('signs in a registered user and stores the refresh token', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        isNewUser: false,
      });
      user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.googleLogin({ idToken: 'google-token' }),
      ).resolves.toEqual({ user: { id: 'user-1' }, ...tokens });
      expect(firebase.signInWithGoogle).toHaveBeenCalledWith('google-token');
      expect(refreshToken.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', token: 'firebase-refresh-token' },
        update: { token: 'firebase-refresh-token' },
      });
    });

    it('404s an unregistered user and drops the Firebase account it created', async () => {
      firebase.signInWithGoogle.mockResolvedValue(google);
      user.findUnique.mockResolvedValue(null);

      await expect(
        service.googleLogin({ idToken: 'google-token' }),
      ).rejects.toThrow(NotFoundException);
      expect(firebase.auth.deleteUser).toHaveBeenCalledWith('firebase-uid');
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });

    it('keeps a pre-existing Firebase account with no local user', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        isNewUser: false,
      });
      user.findUnique.mockResolvedValue(null);

      await expect(
        service.googleLogin({ idToken: 'google-token' }),
      ).rejects.toThrow(NotFoundException);
      expect(firebase.auth.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('googleRegister', () => {
    it('creates the user from the Google profile with its refresh token', async () => {
      firebase.signInWithGoogle.mockResolvedValue(google);
      user.create.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.googleRegister({ idToken: 'google-token', role: Role.BUYER }),
      ).resolves.toEqual({ user: { id: 'user-1' }, ...tokens });
      expect(user.create).toHaveBeenCalledWith({
        data: {
          firebaseUid: 'firebase-uid',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Okafor',
          phoneNumber: undefined,
          role: Role.BUYER,
          isVerified: true,
          farmer: undefined,
          refreshToken: { create: { token: 'firebase-refresh-token' } },
        },
      });
    });

    it('409s an already-registered user without deleting their account', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        isNewUser: false,
      });
      user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.googleRegister({ idToken: 'google-token', role: Role.BUYER }),
      ).rejects.toThrow(ConflictException);
      expect(firebase.auth.deleteUser).not.toHaveBeenCalled();
    });

    it('rolls back the Firebase account it created when the write fails', async () => {
      firebase.signInWithGoogle.mockResolvedValue(google);
      user.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.googleRegister({ idToken: 'google-token', role: Role.BUYER }),
      ).rejects.toThrow('db down');
      expect(firebase.auth.deleteUser).toHaveBeenCalledWith('firebase-uid');
    });
  });
});
