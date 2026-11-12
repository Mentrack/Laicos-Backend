import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FarmerStatus, Role } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { AccountStandingGuard } from '../guards/account-standing.guard';

function contextFor(role: Role): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AccountStandingGuard', () => {
  const findUnique = jest.fn();
  const findAgent = jest.fn();
  const reflector = new Reflector();
  const guard = new AccountStandingGuard(
    {
      farmer: { findUnique },
      agent: { findUnique: findAgent },
    } as unknown as PrismaService,
    reflector,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ status: FarmerStatus.ACTIVE });
  });

  it('lets an active farmer through', async () => {
    await expect(guard.canActivate(contextFor(Role.FARMER))).resolves.toBe(
      true,
    );
  });

  it('does not look anyone up for admins and buyers', async () => {
    await expect(guard.canActivate(contextFor(Role.ADMIN))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(Role.BUYER))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(findAgent).not.toHaveBeenCalled();
  });

  it('stops a disabled farmer with a distinct code', async () => {
    findUnique.mockResolvedValue({ status: FarmerStatus.DISABLED });
    const error: unknown = await guard
      .canActivate(contextFor(Role.FARMER))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account is suspended',
    });
  });

  it('lets a disabled farmer reach an exempt route', async () => {
    findUnique.mockResolvedValue({ status: FarmerStatus.DISABLED });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextFor(Role.FARMER))).resolves.toBe(
      true,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  describe('extension agents', () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    it('stops a suspended agent with ACCOUNT_SUSPENDED', async () => {
      findAgent.mockResolvedValue({ suspendedAt: past, suspendedUntil: null });
      const error: unknown = await guard
        .canActivate(contextFor(Role.EXTENSION_AGENT))
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended',
      });
      expect(findAgent).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { suspendedAt: true, suspendedUntil: true },
      });
    });

    it('stops an agent whose timed suspension has not ended', async () => {
      findAgent.mockResolvedValue({
        suspendedAt: past,
        suspendedUntil: future,
      });
      await expect(
        guard.canActivate(contextFor(Role.EXTENSION_AGENT)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an agent through once the suspension ended', async () => {
      findAgent.mockResolvedValue({ suspendedAt: past, suspendedUntil: past });
      await expect(
        guard.canActivate(contextFor(Role.EXTENSION_AGENT)),
      ).resolves.toBe(true);
    });

    it('lets an agent without an Agent row through', async () => {
      findAgent.mockResolvedValue(null);
      await expect(
        guard.canActivate(contextFor(Role.EXTENSION_AGENT)),
      ).resolves.toBe(true);
    });

    it('lets a suspended agent reach an exempt route', async () => {
      findAgent.mockResolvedValue({ suspendedAt: past, suspendedUntil: null });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      await expect(
        guard.canActivate(contextFor(Role.EXTENSION_AGENT)),
      ).resolves.toBe(true);
      expect(findAgent).not.toHaveBeenCalled();
    });
  });
});
