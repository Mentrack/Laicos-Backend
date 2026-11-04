import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ActivationGuard } from '../guards/activation.guard';

function contextFor(
  role: Role,
  activatedAt: Date | null,
  isVerified = true,
): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'user-1', role, activatedAt, isVerified },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ActivationGuard', () => {
  const application = { findUnique: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new ActivationGuard(
    { application } as unknown as PrismaService,
    reflector as unknown as Reflector,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    application.findUnique.mockResolvedValue(null);
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  it('lets an activated farmer through', async () => {
    await expect(
      guard.canActivate(contextFor(Role.FARMER, new Date())),
    ).resolves.toBe(true);
  });

  it('lets an activated agent through', async () => {
    await expect(
      guard.canActivate(contextFor(Role.EXTENSION_AGENT, new Date())),
    ).resolves.toBe(true);
  });

  it('ignores activation for other roles', async () => {
    await expect(guard.canActivate(contextFor(Role.BUYER, null))).resolves.toBe(
      true,
    );
  });

  it('stops a farmer with no application with a distinct code', async () => {
    await expect(
      guard.canActivate(contextFor(Role.FARMER, null)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(contextFor(Role.FARMER, null));
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'VERIFICATION_PENDING',
        message: 'Your farm is awaiting verification',
      });
    }
  });

  it('stops an agent with no application with the same code', async () => {
    await expect(
      guard.canActivate(contextFor(Role.EXTENSION_AGENT, null)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(contextFor(Role.EXTENSION_AGENT, null));
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'VERIFICATION_PENDING',
        message: 'Your profile is awaiting verification',
      });
    }
  });

  it('lets an applicant read a route marked for the application', async () => {
    application.findUnique.mockResolvedValue({ id: 'app-1' });
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(
      guard.canActivate(contextFor(Role.FARMER, null)),
    ).resolves.toBe(true);
  });

  it('stops an applicant everywhere else with APPLICATION_PENDING', async () => {
    application.findUnique.mockResolvedValue({ id: 'app-1' });
    await expect(
      guard.canActivate(contextFor(Role.FARMER, null)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(contextFor(Role.FARMER, null));
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'APPLICATION_PENDING',
      });
    }
  });

  it.each([Role.BUYER, Role.RIDER])(
    'stops an unverified %s whose token came straight from Firebase',
    async (role) => {
      await expect(
        guard.canActivate(contextFor(role, null, false)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
});
