import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';
import { invalidVerificationCodeError } from '../utils/email-verification';

const tokens = {
  idToken: 'id',
  refreshToken: 'refresh',
  localId: 'uid-1',
  expiresIn: '3600',
};
const unverified = {
  id: 'user-1',
  firebaseUid: 'uid-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  role: Role.BUYER,
  isVerified: false,
  activatedAt: null,
};
const registerDto = {
  email: 'ada@example.com',
  password: 'Password1!',
  firstName: 'Ada',
  lastName: 'Okafor',
  role: Role.BUYER,
} as const;

describe('AuthService email verification', () => {
  const user = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  const refreshToken = { upsert: jest.fn() };
  const database = {
    user,
    refreshToken,
  };
  const firebase = {
    signInWithPassword: jest.fn(),
    signInWithCustomToken: jest.fn(),
    signInWithGoogle: jest.fn(),
    refreshIdToken: jest.fn(),
    auth: {
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
    },
  };
  const otp = {
    issue: jest.fn(),
    verify: jest.fn(),
    discard: jest.fn(),
    resend: jest.fn(),
  };
  const service = new AuthService(
    database as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    otp as unknown as EmailOtpService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    firebase.auth.createUser.mockResolvedValue({ uid: 'uid-1' });
    firebase.auth.deleteUser.mockResolvedValue(undefined);
    firebase.auth.updateUser.mockResolvedValue({});
    firebase.signInWithPassword.mockResolvedValue(tokens);
    firebase.signInWithCustomToken.mockResolvedValue(tokens);
    firebase.refreshIdToken.mockResolvedValue(tokens);
    user.create.mockResolvedValue(unverified);
    user.findUnique.mockResolvedValue(unverified);
    user.update.mockResolvedValue({ ...unverified, isVerified: true });
    otp.issue.mockResolvedValue(undefined);
    otp.verify.mockResolvedValue(undefined);
    otp.discard.mockResolvedValue({ count: 1 });
  });

  describe('register', () => {
    it('creates an unverified user, issues a code and signs nobody in', async () => {
      await expect(service.register(registerDto)).resolves.toBeUndefined();
      expect(user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isVerified: false }) as unknown,
      });
      expect(otp.issue).toHaveBeenCalledWith(unverified);
      expect(firebase.signInWithPassword).not.toHaveBeenCalled();
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });

    it('still succeeds when the code email fails', async () => {
      otp.issue.mockRejectedValue(new Error('SMTP down'));
      await expect(service.register(registerDto)).resolves.toBeUndefined();
      expect(firebase.auth.deleteUser).not.toHaveBeenCalled();
    });

    it('drops the Firebase account when the local user fails', async () => {
      user.create.mockRejectedValue(new ConflictException());
      await expect(service.register(registerDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(firebase.auth.deleteUser).toHaveBeenCalledWith('uid-1');
      expect(otp.issue).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    const dto = { email: 'ada@example.com', code: '1234' };

    it('verifies in Firebase and locally, then signs in', async () => {
      const session = await service.verifyEmail(dto);
      expect(otp.verify).toHaveBeenCalledWith('user-1', '1234');
      expect(firebase.auth.updateUser).toHaveBeenCalledWith('uid-1', {
        emailVerified: true,
      });
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isVerified: true },
      });
      expect(firebase.signInWithCustomToken).toHaveBeenCalledWith('uid-1');
      expect(otp.discard).toHaveBeenCalledWith('user-1');
      // The code goes last, so a failure before it leaves a retry possible.
      expect(otp.discard.mock.invocationCallOrder[0]).toBeGreaterThan(
        refreshToken.upsert.mock.invocationCallOrder[0],
      );
      expect(session).toEqual({
        user: { ...unverified, isVerified: true },
        accessToken: 'id',
        refreshToken: 'refresh',
        expiresIn: '3600',
      });
    });

    it('answers an unknown email like a wrong code', async () => {
      user.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail(dto)).rejects.toEqual(
        invalidVerificationCodeError(),
      );
      expect(otp.verify).not.toHaveBeenCalled();
    });

    it('answers a verified email whose code is spent like a wrong code', async () => {
      user.findUnique.mockResolvedValue({ ...unverified, isVerified: true });
      otp.verify.mockRejectedValue(invalidVerificationCodeError());
      await expect(service.verifyEmail(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(firebase.auth.updateUser).not.toHaveBeenCalled();
    });

    it('keeps the code when sign-in fails after verifying', async () => {
      firebase.signInWithCustomToken.mockRejectedValue(new Error('down'));
      await expect(service.verifyEmail(dto)).rejects.toThrow('down');
      expect(otp.discard).not.toHaveBeenCalled();
    });

    it('finishes signing in on a retry with the same code', async () => {
      const verified = { ...unverified, isVerified: true };
      user.findUnique.mockResolvedValue(verified);
      user.update.mockResolvedValue(verified);
      const session = await service.verifyEmail(dto);
      expect(session.accessToken).toBe('id');
      expect(otp.discard).toHaveBeenCalledWith('user-1');
    });

    it('changes nothing when the code is wrong', async () => {
      otp.verify.mockRejectedValue(invalidVerificationCodeError());
      await expect(service.verifyEmail(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(firebase.auth.updateUser).not.toHaveBeenCalled();
      expect(user.update).not.toHaveBeenCalled();
    });

    it('leaves the code usable when Firebase fails', async () => {
      firebase.auth.updateUser.mockRejectedValue(new Error('Firebase down'));
      await expect(service.verifyEmail(dto)).rejects.toThrow('Firebase down');
      expect(user.update).not.toHaveBeenCalled();
      expect(otp.discard).not.toHaveBeenCalled();
    });
  });

  describe.each([Role.BUYER, Role.RIDER])('an unverified %s', (role) => {
    beforeEach(() =>
      user.findUnique.mockResolvedValue({ ...unverified, role }),
    );

    it('cannot log in', async () => {
      const error = await service
        .login({ email: 'ada@example.com', password: 'x' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });

    it('cannot refresh', async () => {
      await expect(service.refreshToken('refresh')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  it('lets a verified buyer log in', async () => {
    user.findUnique.mockResolvedValue({ ...unverified, isVerified: true });
    await expect(
      service.login({ email: 'ada@example.com', password: 'x' }),
    ).resolves.toMatchObject({ accessToken: 'id' });
  });

  it('delegates resend to the OTP service', async () => {
    await service.resendVerification('ada@example.com');
    expect(otp.resend).toHaveBeenCalledWith('ada@example.com');
  });

  describe('googleLogin', () => {
    const google = { ...tokens, isNewUser: false };

    it('trusts Google for an unverified password buyer', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        emailVerified: true,
      });
      const session = await service.googleLogin({ idToken: 'g' });
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isVerified: true },
      });
      expect(session.user.isVerified).toBe(true);
    });

    it('refuses when neither we nor Google verified the email', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        emailVerified: false,
      });
      const error = await service
        .googleLogin({ idToken: 'g' })
        .catch((e: unknown) => e);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
      expect(refreshToken.upsert).not.toHaveBeenCalled();
    });
  });
});
