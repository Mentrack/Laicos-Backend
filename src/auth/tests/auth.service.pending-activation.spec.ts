import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { FirebaseService } from '../firebase/firebase.service';

const tokens = {
  idToken: 'id',
  refreshToken: 'refresh',
  localId: 'uid-1',
  expiresIn: '3600',
};
describe.each([Role.FARMER, Role.EXTENSION_AGENT])(
  'AuthService with a pending %s',
  (role) => {
    const pending = {
      id: 'user-1',
      role,
      activatedAt: null,
      firstName: 'Ada',
    };
    const user = { findUnique: jest.fn() };
    const refreshToken = { upsert: jest.fn() };
    const database = { user, refreshToken };
    const firebase = {
      signInWithPassword: jest.fn(),
      signInWithGoogle: jest.fn(),
      refreshIdToken: jest.fn(),
      generatePasswordResetLink: jest.fn(),
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
      user.findUnique.mockResolvedValue(pending);
      firebase.signInWithPassword.mockResolvedValue(tokens);
      firebase.refreshIdToken.mockResolvedValue(tokens);
      firebase.signInWithGoogle.mockResolvedValue({
        ...tokens,
        isNewUser: false,
      });
    });

    it('refuses a password login without storing a session', async () => {
      await expect(
        service.login({ email: 'ada@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });

    it('refuses a Google login', async () => {
      await expect(
        service.googleLogin({ idToken: 'google' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });

    it('refuses a token refresh', async () => {
      await expect(service.refreshToken('refresh')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sends no reset link, so no password can be set before activation', async () => {
      await service.forgotPassword('ada@example.com');
      expect(firebase.generatePasswordResetLink).not.toHaveBeenCalled();
    });
  },
);
