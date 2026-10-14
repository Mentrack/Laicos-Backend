import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FirebaseService } from '../firebase/firebase.service';
import {
  assertActivated,
  passwordChangeRequiredError,
  requireLocalUser,
  verifySessionToken,
} from '../utils/session';

describe('session helpers', () => {
  const verifyIdToken = jest.fn();
  const findUnique = jest.fn();
  const firebase = { auth: { verifyIdToken } } as unknown as FirebaseService;
  const database = { user: { findUnique } } as unknown as PrismaService;

  beforeEach(() => jest.resetAllMocks());

  it('verifies the token with revocation checks', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    await expect(verifySessionToken(firebase, 'token')).resolves.toEqual({
      uid: 'uid-1',
    });
    expect(verifyIdToken).toHaveBeenCalledWith('token', true);
  });

  it('turns any verification failure into a 401', async () => {
    verifyIdToken.mockRejectedValue(new Error('revoked'));
    const error: unknown = await verifySessionToken(firebase, 'token').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe(
      'Invalid or expired token',
    );
  });

  it('loads the local user by Firebase uid', async () => {
    const user = { id: 'user-1' } as User;
    findUnique.mockResolvedValue(user);
    await expect(requireLocalUser(database, 'uid-1')).resolves.toBe(user);
    expect(findUnique).toHaveBeenCalledWith({
      where: { firebaseUid: 'uid-1' },
    });
  });

  it('refuses a Firebase user with no local account', async () => {
    findUnique.mockResolvedValue(null);
    const error: unknown = await requireLocalUser(database, 'uid-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(
      'Complete registration first',
    );
  });

  it('refuses an agent awaiting verification', () => {
    expect(() =>
      assertActivated({
        role: Role.EXTENSION_AGENT,
        activatedAt: null,
        isVerified: true,
      }),
    ).toThrow('Your profile is awaiting verification');
  });

  it('refuses a buyer with an unverified email', () => {
    expect(() =>
      assertActivated({
        role: Role.BUYER,
        activatedAt: null,
        isVerified: false,
      }),
    ).toThrow('Verify your email to continue');
  });

  it('passes an activated agent and a verified buyer', () => {
    expect(() =>
      assertActivated({
        role: Role.EXTENSION_AGENT,
        activatedAt: new Date(),
        isVerified: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertActivated({
        role: Role.BUYER,
        activatedAt: null,
        isVerified: true,
      }),
    ).not.toThrow();
  });

  it('gives the password-change refusal its own code', () => {
    expect(passwordChangeRequiredError().getResponse()).toEqual({
      message: 'Change your password to continue',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  });
});
