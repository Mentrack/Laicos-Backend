import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FarmerStatus, Role } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { FarmerStandingGuard } from '../guards/farmer-standing.guard';

function contextFor(role: Role): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('FarmerStandingGuard', () => {
  const findUnique = jest.fn();
  const reflector = new Reflector();
  const guard = new FarmerStandingGuard(
    { farmer: { findUnique } } as unknown as PrismaService,
    reflector,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ status: FarmerStatus.ACTIVE });
  });

  it('lets an active farmer through', async () => {
    await expect(guard.canActivate(contextFor(Role.FARMER))).resolves.toBe(
      true,
    );
  });

  it('does not look up a farmer for other roles', async () => {
    await expect(guard.canActivate(contextFor(Role.ADMIN))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
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
});
