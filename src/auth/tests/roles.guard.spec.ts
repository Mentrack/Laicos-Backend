import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../generated/client';
import { RolesGuard } from '../guards/roles.guard';

function contextFor(role: Role): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('lets any user through when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(guard.canActivate(contextFor(Role.BUYER))).toBe(true);
  });

  it('lets a user with a required role through', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.FARMER]);
    expect(guard.canActivate(contextFor(Role.FARMER))).toBe(true);
  });

  it('rejects a user without a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.FARMER]);
    expect(() => guard.canActivate(contextFor(Role.BUYER))).toThrow(
      ForbiddenException,
    );
  });
});
