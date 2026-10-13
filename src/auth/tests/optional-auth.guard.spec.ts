import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, type User } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FirebaseService } from '../firebase/firebase.service';
import { OptionalAuthGuard } from '../guards/optional-auth.guard';

const buyer = {
  id: 'buyer-1',
  role: Role.BUYER,
  isVerified: true,
  mustChangePassword: false,
} as User;

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OptionalAuthGuard', () => {
  const verifyIdToken = jest.fn();
  const findUnique = jest.fn();
  const reflector = new Reflector();
  const guard = new OptionalAuthGuard(
    { auth: { verifyIdToken } } as unknown as FirebaseService,
    { user: { findUnique } } as unknown as PrismaService,
    reflector,
  );

  beforeEach(() => jest.resetAllMocks());

  it('lets a request with no Authorization header through as a guest', async () => {
    const request = { headers: {} };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request).not.toHaveProperty('user');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('loads the user when a valid token is sent', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    findUnique.mockResolvedValue(buyer);
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer good' },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toBe(buyer);
  });

  it('401s on an invalid token instead of treating it as a guest', async () => {
    verifyIdToken.mockRejectedValue(new Error('expired'));
    const request = { headers: { authorization: 'Bearer bad' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s on an empty Authorization header', async () => {
    const request = { headers: { authorization: '' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('403s a token with no local user', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    findUnique.mockResolvedValue(null);
    const request = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403s a user who must change their password', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    findUnique.mockResolvedValue({ ...buyer, mustChangePassword: true });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const request = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
