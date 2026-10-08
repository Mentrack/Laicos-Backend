import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PasswordChangeGuard } from '../guards/password-change.guard';

function contextFor(mustChangePassword: boolean): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { mustChangePassword } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PasswordChangeGuard', () => {
  const reflector = new Reflector();
  const guard = new PasswordChangeGuard(reflector);

  beforeEach(() => jest.restoreAllMocks());

  it('lets a user with a permanent password through', () => {
    expect(guard.canActivate(contextFor(false))).toBe(true);
  });

  it('stops a user on a temporary password with a distinct code', () => {
    let error: unknown;
    try {
      guard.canActivate(contextFor(true));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  });

  it('lets a user on a temporary password reach an exempt route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(contextFor(true))).toBe(true);
  });
});
